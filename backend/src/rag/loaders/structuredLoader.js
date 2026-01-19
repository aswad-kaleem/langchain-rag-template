import { Document } from "@langchain/core/documents";
import { query } from "../../db/mysql.js";
import { config } from "../../config/env.js";

// Table-specific "title" field preferences to produce better summaries
// while still embedding all columns.
const TITLE_FIELDS_BY_TABLE = {
  activity_logs: ["module", "action"],
  allowances: ["allowance_type"],
  allowance_details: ["allowance_amount"],
  allowance_items: ["allowance_item", "allowance_description"],
  attendances: ["reason", "status"],
  attendance_device_info: ["name"],
  bank_info: ["bank_name", "account_holder_name"],
  configurations: ["config_key"],
  create_public_holidays: ["description"],
  departments: ["department_name", "description"],
  employees: ["employee_name", "designation", "department"],
  employee_dependent: ["name"],
  employee_documents: ["document_name", "employee_document"],
  employee_allowances: ["allowance_type", "payment_type"],
  employee_leaves: [],
  employee_roles: [],
  employee_salary_records: [],
  leave_types: ["leave_name"],
  migrations: ["name"],
  migrations_lock: [],
  permissions: ["permission", "module", "route"],
  relation_types: ["relation_type"],
  requested_leaves: ["leave_name", "employee_reason"],
  roles: ["role_name"],
  role_permissions: [],
  users: ["first_name", "last_name", "email"],
  public_holidays: ["name"],
  employment_types: ["employee_type"]
};

// Tables that are logically part of an employee "profile". We'll build
// richer, denormalized documents for each employee combining these.
const EMPLOYEE_PROFILE_TABLES = [
  "employees",
  "bank_info",
  "employee_dependent",
  "employee_documents",
  "employee_leaves",
  "employee_salary_records",
  "attendances",
  "requested_leaves",
  "employee_roles",
  "roles",
  "role_permissions",
  "permissions"
];

/**
 * Load structured data from a MySQL database and convert rows into
 * LangChain Documents for use in the RAG pipeline.
 *
 * This implementation works generically with arbitrary table schemas.
 * It prefers common text fields when present, but will fall back to
 * concatenating all non-empty columns into a single text blob.
 *
 * Default table: knowledge_base
 * Configure via DB_TABLE_NAME environment variable.
 * You can pass multiple tables as a comma-separated list, e.g.:
 *   DB_TABLE_NAME=table1,table2,table3
 *
 * Example table schema (not required, just illustrative):
 *   CREATE TABLE knowledge_base (
 *     id INT PRIMARY KEY AUTO_INCREMENT,
 *     title VARCHAR(255),
 *     body TEXT,
 *     tags VARCHAR(255),
 *     source VARCHAR(255)
 *   );
 */
export async function loadStructuredDocuments() {
  try {
    const raw = config.dbTableName || "";
    const tableNames = raw
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    if (tableNames.length === 0) {
      console.warn("No DB_TABLE_NAME configured; skipping structured records.");
      return [];
    }

    const allDocs = [];
    const perTableCounts = {};

    // First: generic row-level documents for all configured tables
    // (including employee-related tables), so every row is represented.
    for (const tableName of tableNames) {
      // Validate table name contains only safe characters (alphanumeric, underscore, hyphen)
      if (!/^[a-zA-Z0-9_-]+$/.test(tableName)) {
        console.warn(
          `Skipping invalid table name: ${tableName}. Only alphanumeric, underscore, and hyphen allowed.`
        );
        continue;
      }

      try {
        // Generic query: select all columns and let the serializer
        // decide how to turn the row into text. This avoids relying
        // on specific column names that may not exist.
        const rows = await query(`SELECT * FROM \`${tableName}\``);

        if (!rows || rows.length === 0) {
          console.warn(
            `MySQL query for structured documents returned no rows from table ${tableName}.`
          );
          continue;
        }

        rows.forEach((row, idx) => {
          const recordId = row.id ?? idx;
          const titleField =
            row.title ??
            row.name ??
            row.subject ??
            row.code ??
            row.description ??
            null;

          allDocs.push(
            new Document({
              pageContent: serializeRecordToText(row, tableName),
              metadata: {
                source: "structured-db",
                table: tableName,
                recordId,
                title: titleField || undefined,
                origin: `mysql.${tableName}`
              }
            })
          );
          perTableCounts[tableName] = (perTableCounts[tableName] || 0) + 1;
        });
      } catch (tableErr) {
        console.warn(
          `Warning: Failed to load structured records from MySQL table ${tableName}:`,
          tableErr.message || tableErr
        );
      }
    }

    // Second: build rich, denormalized employee profile documents that
    // join data from all employee-related tables. This lets RAG answer
    // questions about employees using their relational data.
    if (tableNames.includes("employees")) {
      const employeeProfiles = await buildEmployeeProfileDocuments();
      employeeProfiles.forEach((doc) => allDocs.push(doc));
      if (employeeProfiles.length > 0) {
        console.log(
          `Built ${employeeProfiles.length} aggregated employee profile documents for RAG.`
        );
      }
    }

    if (allDocs.length === 0) {
      console.warn(
        "MySQL query for structured documents returned no rows from any configured table."
      );
    } else {
      console.log(
        "Loaded structured records for RAG from MySQL:",
        Object.entries(perTableCounts).map(([table, count]) => ({ table, count }))
      );
    }

    return allDocs;
  } catch (err) {
    console.warn(
      "Warning: Failed to load structured records from MySQL:",
      err.message || err
    );
    return [];
  }
}

function serializeRecordToText(row, tableName) {
  // Prefer table-specific title fields when available
  const preferred = TITLE_FIELDS_BY_TABLE[tableName] || [];
  let titleField = null;

  for (const key of preferred) {
    if (row[key]) {
      titleField = row[key];
      break;
    }
  }

  // Fallback to generic title-like fields if no table-specific one matched
  if (!titleField) {
    titleField =
      row.title ??
      row.name ??
      row.subject ??
      row.code ??
      row.description ??
      null;
  }

  const lines = [];

  if (titleField) {
    lines.push(`Title: ${titleField}`);
  }

  lines.push(`Table: ${tableName}`);

  const fieldLines = Object.entries(row)
    .filter(([key, value]) =>
      key !== "id" && value !== null && value !== undefined && value !== ""
    )
    .map(([key, value]) => {
      const v =
        typeof value === "object" && value !== null
          ? JSON.stringify(value)
          : String(value);
      return `${key}: ${v}`;
    });

  if (fieldLines.length > 0) {
    lines.push(fieldLines.join("\n"));
  }

  return lines.join("\n\n").trim();
}

function groupBy(rows, key) {
  const map = {};
  for (const row of rows || []) {
    const id = row[key];
    if (id === null || id === undefined) continue;
    if (!map[id]) map[id] = [];
    map[id].push(row);
  }
  return map;
}

async function buildEmployeeProfileDocuments() {
  try {
    const employees = await query("SELECT * FROM `employees`");
    if (!employees || employees.length === 0) {
      console.warn("No employees found for building profile documents.");
      return [];
    }

    const [
      bankRows,
      depRows,
      docRows,
      leavesRows,
      salaryRows,
      attendanceRows,
      requestedLeaveRows,
      employeeRoleRows,
      roleRows,
      rolePermissionRows,
      permissionRows
    ] = await Promise.all([
      query("SELECT * FROM `bank_info`"),
      query("SELECT * FROM `employee_dependent`"),
      query("SELECT * FROM `employee_documents`"),
      query("SELECT * FROM `employee_leaves`"),
      query("SELECT * FROM `employee_salary_records`"),
      query("SELECT * FROM `attendances`"),
      query("SELECT * FROM `requested_leaves`"),
      query("SELECT * FROM `employee_roles`"),
      query("SELECT * FROM `roles`"),
      query("SELECT * FROM `role_permissions`"),
      query("SELECT * FROM `permissions`")
    ]);

    const bankByEmployee = groupBy(bankRows, "employee_id");
    const depByEmployee = groupBy(depRows, "employee_id");
    const docsByEmployee = groupBy(docRows, "employee_id");
    const leavesByEmployee = groupBy(leavesRows, "employee_id");
    const salaryByEmployee = groupBy(salaryRows, "employee_id");
    const attendanceByEmployee = groupBy(attendanceRows, "employee_id");
    const attendanceByDeviceId = groupBy(attendanceRows, "attendance_device_id");
    const requestedLeavesByEmployee = groupBy(requestedLeaveRows, "employee_id");
    const employeeRolesByEmployee = groupBy(employeeRoleRows, "employee_id");

    const rolesById = {};
    for (const r of roleRows || []) {
      if (r.id !== null && r.id !== undefined) {
        rolesById[r.id] = r;
      }
    }

    const permissionsById = {};
    for (const p of permissionRows || []) {
      if (p.id !== null && p.id !== undefined) {
        permissionsById[p.id] = p;
      }
    }

    const rolePermissionsByEmployee = groupBy(rolePermissionRows, "employee_id");

    const docs = [];

    for (const emp of employees) {
      const employeeId = emp.id;
      const title =
        emp.employee_name ||
        emp.office_email ||
        `Employee #${employeeId}`;

      const lines = [];
      lines.push(`Title: ${title}`);
      lines.push("Table: employees (aggregated profile)");

      // Core employee fields
      const coreFieldLines = Object.entries(emp)
        .filter(([key, value]) =>
          key !== "id" && value !== null && value !== undefined && value !== ""
        )
        .map(([key, value]) => {
          const v =
            typeof value === "object" && value !== null
              ? JSON.stringify(value)
              : String(value);
          return `${key}: ${v}`;
        });
      if (coreFieldLines.length > 0) {
        lines.push("Core employee data:");
        lines.push(coreFieldLines.join("\n"));
      }

      // Attendance can be linked either by employee_id or by
      // attendance_device_id. Merge both sources so an employee's
      // attendance is found even if only device ID is populated.
      const byEmp = attendanceByEmployee[employeeId] || [];
      const byDeviceId =
        emp.attendance_device_id !== null && emp.attendance_device_id !== undefined
          ? attendanceByDeviceId[emp.attendance_device_id] || []
          : [];

      const attendanceMerged = [];
      const seenAttendanceIds = new Set();
      for (const row of [...byEmp, ...byDeviceId]) {
        const key =
          row.id ?? `${row.employee_id ?? ""}-${row.attendance_device_id ?? ""}-${row.date ?? ""}`;
        if (seenAttendanceIds.has(key)) continue;
        seenAttendanceIds.add(key);
        attendanceMerged.push(row);
      }

      const sections = [
        { label: "Bank info", rows: bankByEmployee[employeeId] },
        { label: "Dependents", rows: depByEmployee[employeeId] },
        { label: "Documents", rows: docsByEmployee[employeeId] },
        { label: "Leave balances", rows: leavesByEmployee[employeeId] },
        { label: "Salary history", rows: salaryByEmployee[employeeId] },
        { label: "Attendance records", rows: attendanceMerged },
        { label: "Requested leaves", rows: requestedLeavesByEmployee[employeeId] }
      ];

      for (const section of sections) {
        const rows = section.rows || [];
        if (!rows.length) continue;
        lines.push(`${section.label}:`);
        rows.forEach((row, idx) => {
          lines.push(`- Record ${idx + 1}:`);
          const rowLines = Object.entries(row)
            .filter(([key, value]) =>
              key !== "id" && key !== "employee_id" && value !== null && value !== undefined && value !== ""
            )
            .map(([key, value]) => {
              const v =
                typeof value === "object" && value !== null
                  ? JSON.stringify(value)
                  : String(value);
              return `${key}: ${v}`;
            });
          if (rowLines.length) {
            lines.push(rowLines.join("\n"));
          }
        });
      }

      // Roles and permissions
      const empRoles = employeeRolesByEmployee[employeeId] || [];
      const empRolePerms = rolePermissionsByEmployee[employeeId] || [];

      if (empRoles.length) {
        lines.push("Roles:");
        empRoles.forEach((er, idx) => {
          const role = er.role_id ? rolesById[er.role_id] : null;
          const roleName = role?.role_name || er.role_id || "unknown";
          lines.push(`- Role ${idx + 1}: ${roleName}`);
        });
      }

      if (empRolePerms.length) {
        lines.push("Direct permissions:");
        empRolePerms.forEach((rp, idx) => {
          const perm = rp.permission_id ? permissionsById[rp.permission_id] : null;
          const parts = [];
          if (perm?.module) parts.push(`module=${perm.module}`);
          if (perm?.permission) parts.push(`permission=${perm.permission}`);
          if (perm?.route) parts.push(`route=${perm.route}`);
          const summary = parts.length ? parts.join(", ") : `id=${rp.permission_id}`;
          lines.push(`- Permission ${idx + 1}: ${summary}`);
        });
      }

      docs.push(
        new Document({
          pageContent: lines.join("\n\n").trim(),
          metadata: {
            source: "structured-db",
            table: "employees_profile",
            recordId: employeeId,
            title,
            origin: "mysql.employees.profile"
          }
        })
      );
    }

    return docs;
  } catch (err) {
    console.warn(
      "Warning: Failed to build aggregated employee profile documents:",
      err.message || err
    );
    return [];
  }
}

