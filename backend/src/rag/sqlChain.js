import { ChatOpenAI } from "@langchain/openai";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { config } from "../config/env.js";
import { queryDb } from "../db/query.js";
import { semanticSchema } from "./semanticSchema.js";

const allowedTables = [
  'activity_logs',
  'allowance_details',
  'allowance_items',
  'allowances',
  'attendance_device_info',
  'attendances',
  'bank_info',
  'configurations',
  'departments',
  'employee_allowances',
  'employee_dependent',
  'employee_documents',
  'employee_leaves',
  'employee_roles',
  'employee_salary_records',
  'employees',
  'employment_types',
  'leave_types',
  'permissions',
  'public_holidays',
  'relation_types',
  'requested_leaves',
  'role_permissions',
  'roles',
];


const joinGuidance = `Join rules:
- Primary link: attendances.attendance_device_id = employees.attendance_device_id (employee_id is often null in attendances)
- Optional: employee_leaves.employee_id = employees.id (only if needed)
- Optional: attendances.attendance_device_id = attendance_device_info.id
- Optional: departments.id can be joined only if a department id exists in employees.department (if stored as id)
- For leave category names: employee_leaves.leave_type_id = leave_types.id
- For roles/permissions:
  - employee_roles.employee_id = employees.id
  - employee_roles.role_id = roles.id
  - roles.permission_ids is a JSON array of permission ids → join permissions with JSON_CONTAINS(roles.permission_ids, CAST(permissions.id AS JSON))
  - If using role_permissions, join role_permissions.employee_id = employees.id and role_permissions.permission_id = permissions.id (there is no role_id column there)`;

const semanticSchemaText = JSON.stringify(semanticSchema, null, 2);

const sqlPrompt = ChatPromptTemplate.fromTemplate(
  `You are a MySQL text-to-SQL assistant for Convier Solutions.

You have access to the following semantic database schema.
Use ONLY the tables, columns, and joins defined below.
Never guess column names.
Always use relations when data spans multiple entities.

{semanticSchema}

Use ONLY these tables: {tableList}.
{joinGuidance}

 Column hints (use real columns only):
 - employees: id, employee_name, attendance_device_id, personal_contact_number, emergency_contact_number, personal_email, employee_address, department, designation, office_email, joining_date, current_salary, is_active
 - attendances: id, employee_id (often null), attendance_device_id, check_in, check_out, date, status
 - attendance_device_info: id, name, ip, port, is_active
 - departments: id, department_name, description, is_active
 - employee_leaves: id, employee_id, leave_type_id, total_leaves, year, remaining_leaves, is_active
 - leave_types: id, leave_name, total_leaves, is_active
 - employee_roles: id, employee_id, role_id, is_active
 - roles: id, role_name, description, permission_ids (JSON array of permission ids), is_active
 - role_permissions: id, employee_id, permission_id, is_active (no role_id column)
 - permissions: id, module, permission, route, api_endpoint, method, is_active

 Rules:
- SELECT statements only.
- Do not modify data.
- Prefer concise projections over SELECT *.
- If counting/aggregating, omit LIMIT.
- Otherwise add LIMIT 50.
- Keep joins minimal and aligned to the join rules above.
- If data seems unavailable, still return the best-faith SELECT.

 Projection & readability guidelines:
- Never return only ID columns in the SELECT list unless the user explicitly asks only for IDs.
- For each main entity, always include at least one or two human-friendly descriptive fields (name, title, email, status, date, amount, etc.).
- For employees, when looking up a specific person, include employee_name and relevant contact/role fields (e.g., personal_contact_number, emergency_contact_number, personal_email, office_email, department, designation) in addition to any IDs.
- For attendances, include date, status, reason (if present), and the attendance_device_id rather than only IDs.
- For leave balances, include year, leave_type_id and remaining_leaves.
- For activity_logs, include module, action, record_id, created_at (and user_id if useful) so the log can be explained in natural language.

 Contact details:
 - If the user asks for "contact number", "phone", "mobile", or "emergency contact" of an employee, select personal_contact_number, emergency_contact_number, personal_email, and office_email from employees (when they exist), instead of only returning the office_email.

 Default "list all" behavior (no filters provided):
 - For employees: select id, employee_name, office_email, department, designation, is_active from employees.
 - For attendances: select id, employee_id, attendance_device_id, date, status from attendances.
 - For employee_leaves: select employee_id, year, leave_type_id AS category_id, remaining_leaves from employee_leaves.
 - For roles/permissions: select roles.role_name, permissions.module, permissions.permission, permissions.route from roles and permissions using the join rules above.
 - Always include LIMIT 50 for these list-all queries.

 Name matching:
 - Users may provide partial or slightly misspelled names; match employees with WHERE employee_name LIKE '%name%'.
 - If both name and attendance_device_id hints are present, prefer attendance_device_id for precision.

 Leave categories:
 - Join leave_types on employee_leaves.leave_type_id = leave_types.id to return leave_types.leave_name as category_name when possible.
 - Always also include leave_type_id as category_id in the SELECT for clarity.

 Permissions via roles:
 - roles.permission_ids is a JSON array of permission ids. To join permissions, use JSON_CONTAINS(roles.permission_ids, CAST(permissions.id AS JSON)).
 - If employee_roles is present, link employee_roles.role_id = roles.id, then expand permissions via the JSON array.

Return ONLY the SQL statement and nothing else.

User question:
{question}`
);

const answerPrompt = ChatPromptTemplate.fromTemplate(
  `You are an HR data explainer for Convier Solutions.

User question:
{question}

SQL executed:
{sql}

Rows (JSON):
{rowsJson}

Provide a concise, friendly answer using ONLY the data shown. Summarize patterns instead of dumping raw JSON.
- Start by clearly mentioning that this answer is based on live HR/operations database records.
- If rows include category_id (leave_type_id), present it clearly (e.g., "Category 2: 8 remaining leaves").
- If the employee name is present, echo it; if not, describe the match (e.g., matched by attendance device ID).
- If no rows, explicitly say that no matching records were found in the database.
- If the SQL query uses the activity_logs table, describe each log entry in natural language (for example: who did what, on which module/record, and when), instead of listing raw IDs.
- Prefer describing entities using their descriptive fields (names, emails, statuses, dates) and use raw IDs only when absolutely necessary for clarity.
- Unless the user explicitly asks for IDs, do not mention internal numeric identifiers like id, employee_id, record_id, or user_id in the answer. Instead, refer to records generically (e.g., "an employee record" or "a leave record") or by human-readable fields such as names.
- Do not fabricate category names if none are present; just use the category_id.`
);

function buildLlm(options = {}) {
  return new ChatOpenAI({
    apiKey: config.openaiApiKey,
    model: config.openaiModel,
    temperature: options.temperature ?? 0,
    streaming: false,
  });
}

function stripMarkdown(sql) {
  if (!sql) return "";
  let cleaned = sql.trim();
  if (cleaned.startsWith("```") && cleaned.endsWith("```")) {
    cleaned = cleaned.replace(/^```[a-zA-Z]*\n?/, "").replace(/```$/, "").trim();
  }
  return cleaned;
}

function ensureSelectOnly(sql) {
  const normalized = (sql || "").trim();
  const trimmed = normalized.replace(/;+\s*$/g, "");

  if (!/^select\b/i.test(trimmed)) {
    throw new Error("Only SELECT statements are allowed.");
  }
  const forbidden = /(insert|update|delete|drop|alter|truncate|create|grant|revoke|replace|;)/i;
  if (forbidden.test(trimmed)) {
    throw new Error("Statement contains non-SELECT or unsafe content.");
  }
  return trimmed;
}

function ensureAllowedTables(sql) {
  const lowerSql = sql.toLowerCase();
  for (const word of [" from ", " join ", " into ", " update ", " delete "]) {
    if (!lowerSql.includes(word.trim())) continue;
  }
  const tablePattern = /\b(from|join)\s+`?([a-zA-Z0-9_]+)`?/gi;
  let match;
  while ((match = tablePattern.exec(lowerSql))) {
    const raw = match[2];
    const table = raw.includes(".") ? raw.split(".").pop() : raw;
    if (!allowedTables.includes(table)) {
      throw new Error(`Table ${table} is not allowed.`);
    }
  }
  return sql;
}

function ensureLimit(sql) {
  const isCount = /\bcount\s*\(/i.test(sql);
  const hasLimit = /\blimit\b/i.test(sql);
  if (!isCount && !hasLimit) {
    return `${sql} LIMIT 50`;
  }
  return sql;
}

async function generateSql(question) {
  const llm = buildLlm({ temperature: 0 });
  const chain = sqlPrompt.pipe(llm).pipe(new StringOutputParser());
  const rawSql = await chain.invoke({
    question,
    tableList: allowedTables.join(", "),
    joinGuidance,
    semanticSchema: semanticSchemaText,
  });
  let sql = stripMarkdown(rawSql);
  sql = ensureSelectOnly(sql);
  sql = ensureAllowedTables(sql);
  sql = ensureLimit(sql);
  console.log(`[SQL_CHAIN] Generated SQL: ${sql}`);
  return sql;
}

async function executeSql(sql) {
  const timeoutMs = 3000;
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("SQL execution timed out")), timeoutMs)
  );
  const rows = await Promise.race([queryDb(sql), timeoutPromise]);
  return rows;
}

async function formatAnswer(question, sql, rows) {
  const llm = buildLlm({ temperature: config.openaiTemperature ?? 0 });
  const chain = answerPrompt.pipe(llm).pipe(new StringOutputParser());
  const rowsJson = JSON.stringify(rows ?? []).slice(0, 6000);
  return chain.invoke({ question, sql, rowsJson });
}

async function enrichRowsWithEmployees(sql, rows) {
  if (!rows || rows.length === 0) return rows;

  const lowerSql = (sql || "").toLowerCase();
  const touchesActivityLogs = lowerSql.includes("activity_logs");

  const employeeIds = new Set();
  const userIds = new Set();

  for (const row of rows) {
    if (row && typeof row === "object") {
      if (row.employee_id && Number.isFinite(Number(row.employee_id))) {
        employeeIds.add(Number(row.employee_id));
      }
      if (row.target_employee_id && Number.isFinite(Number(row.target_employee_id))) {
        employeeIds.add(Number(row.target_employee_id));
      }
      if (
        touchesActivityLogs &&
        row.module === "Employee" &&
        row.record_id &&
        Number.isFinite(Number(row.record_id))
      ) {
        employeeIds.add(Number(row.record_id));
      }

      if (row.user_id && Number.isFinite(Number(row.user_id))) {
        userIds.add(Number(row.user_id));
      }
    }
  }

  if (employeeIds.size === 0 && userIds.size === 0) {
    return rows;
  }

  const employeeMap = new Map();
  const userMap = new Map();

  if (employeeIds.size > 0) {
    const idsArray = Array.from(employeeIds);
    const idList = idsArray.join(",");

    try {
      const lookupSql = `SELECT id, employee_name, office_email FROM employees WHERE id IN (${idList})`;
      const employeeRows = await executeSql(lookupSql);
      for (const emp of employeeRows || []) {
        if (!emp || !Number.isFinite(Number(emp.id))) continue;
        employeeMap.set(Number(emp.id), {
          employee_name: emp.employee_name,
          office_email: emp.office_email,
        });
      }
    } catch (err) {
      console.warn("Employee enrichment lookup failed:", err?.message || err);
    }
  }

  if (userIds.size > 0) {
    const idsArray = Array.from(userIds);
    const idList = idsArray.join(",");

    try {
      const lookupSql = `SELECT id, first_name, last_name, email FROM users WHERE id IN (${idList})`;
      const userRows = await executeSql(lookupSql);
      for (const u of userRows || []) {
        if (!u || !Number.isFinite(Number(u.id))) continue;
        const fullName = [u.first_name, u.last_name].filter(Boolean).join(" ") || undefined;
        userMap.set(Number(u.id), {
          name: fullName,
          email: u.email,
        });
      }
    } catch (err) {
      console.warn("User enrichment lookup failed:", err?.message || err);
    }
  }

  if (employeeMap.size === 0 && userMap.size === 0) return rows;

  const enriched = rows.map((row) => {
    if (!row || typeof row !== "object") return row;

    let employeeIdCandidate = null;
    if (row.employee_id && Number.isFinite(Number(row.employee_id))) {
      employeeIdCandidate = Number(row.employee_id);
    } else if (
      row.target_employee_id &&
      Number.isFinite(Number(row.target_employee_id))
    ) {
      employeeIdCandidate = Number(row.target_employee_id);
    } else if (
      touchesActivityLogs &&
      row.module === "Employee" &&
      row.record_id &&
      Number.isFinite(Number(row.record_id))
    ) {
      employeeIdCandidate = Number(row.record_id);
    }

    const maybeEmployeeInfo =
      employeeIdCandidate != null && employeeMap.has(employeeIdCandidate)
        ? employeeMap.get(employeeIdCandidate)
        : null;

    const maybeUserInfo =
      row.user_id && userMap.has(Number(row.user_id))
        ? userMap.get(Number(row.user_id))
        : null;

    return {
      ...row,
      employee_name:
        maybeEmployeeInfo?.employee_name ?? row.employee_name,
      employee_office_email:
        maybeEmployeeInfo?.office_email ?? row.employee_office_email,
      actor_name: maybeUserInfo?.name ?? row.actor_name,
      actor_email: maybeUserInfo?.email ?? row.actor_email,
    };
  });

  return enriched;
}

function buildRuleBasedSql(question) {
  const q = (question || "").toLowerCase();
  if (!q) return "";

  const leaveTypeMatch = q.match(/\b(casual|sick|annual|earned|unpaid|paid)\s+leave\b/i);
  const employeeNameMatch = q.match(/\bof\s+([a-zA-Z\s.'-]+)$/i);

  if (leaveTypeMatch) {
    const leaveType = leaveTypeMatch[1].toLowerCase();
    const name = employeeNameMatch ? employeeNameMatch[1].trim() : "";
    const nameFilter = name
      ? ` AND employees.employee_name LIKE '%${name.replace(/'/g, "''")}%'`
      : "";

    return `SELECT employees.employee_name, leave_types.leave_name AS category_name, employee_leaves.remaining_leaves, employee_leaves.year FROM employee_leaves JOIN employees ON employee_leaves.employee_id = employees.id JOIN leave_types ON employee_leaves.leave_type_id = leave_types.id WHERE LOWER(leave_types.leave_name) LIKE '%${leaveType}%'${nameFilter} LIMIT 50`;
  }

  const wantsActivityLogs =
    q.includes("activity log") ||
    q.includes("activity logs") ||
    q.includes("audit log") ||
    q.includes("system log");

  if (wantsActivityLogs) {
    return `SELECT user_id, module, action, record_id, created_at FROM activity_logs ORDER BY created_at DESC LIMIT 50`;
  }

  return "";
}

function applyLimitOffset(sql, limit, offset) {
  const cleaned = (sql || "").replace(/;+\s*$/g, "").trim();
  if (!cleaned) return "";

  const safeLimit = Number.isFinite(limit) && limit > 0 ? limit : 50;
  const safeOffset = Math.max(0, Number.isFinite(offset) ? offset : 0);

  // If this is a COUNT query, we generally don't paginate further.
  if (/\bcount\s*\(/i.test(cleaned)) {
    return cleaned;
  }

  const limitClauseRegex = /\blimit\s+\d+(\s+offset\s+\d+)?/i;
  if (limitClauseRegex.test(cleaned)) {
    return cleaned.replace(limitClauseRegex, `LIMIT ${safeLimit} OFFSET ${safeOffset}`);
  }

  return `${cleaned} LIMIT ${safeLimit} OFFSET ${safeOffset}`;
}

function extractEmployeeNameFromHistory(history = []) {
  if (!Array.isArray(history) || history.length === 0) return "";

  const reversed = [...history].reverse();
  for (const msg of reversed) {
    const text = (msg?.content || "").trim();
    if (!text) continue;

    const whoIsMatch = text.match(/\bwho\s+is\s+([a-zA-Z\s.'-]+)\b/i);
    if (whoIsMatch) return whoIsMatch[1].trim();

    const aboutMatch = text.match(/\babout\s+([a-zA-Z\s.'-]+)\b/i);
    if (aboutMatch) return aboutMatch[1].trim();

    const isMatch = text.match(/\b([A-Z][a-zA-Z.'-]+\s+[A-Z][a-zA-Z.'-]+)\s+is\b/);
    if (isMatch) return isMatch[1].trim();
  }

  return "";
}

function shouldUseEmployeeContext(question) {
  const q = (question || "").toLowerCase();
  if (!q) return false;
  return (
    q.includes("attendance") ||
    q.includes("leave") ||
    q.includes("salary") ||
    q.includes("contact") ||
    q.includes("details") ||
    q.includes("info") ||
    q.includes("profile")
  );
}

function containsPronounReference(question) {
  const q = (question || "").toLowerCase();
  if (!q) return false;
  return (
    q.includes("his ") ||
    q.includes("her ") ||
    q.includes("their ") ||
    q.includes("that employee") ||
    q.includes("this employee") ||
    q.includes("that person") ||
    q.includes("this person")
  );
}

function questionHasPersonName(question) {
  const q = (question || "").trim();
  if (!q) return false;
  return /\b[A-Z][a-zA-Z.'-]+\s+[A-Z][a-zA-Z.'-]+\b/.test(q);
}

export async function runSqlChain(question, history = []) {
  let normalizedQuestion = question || "";
  const hasName = questionHasPersonName(normalizedQuestion);
  const useContext = shouldUseEmployeeContext(normalizedQuestion);
  const hasPronoun = containsPronounReference(normalizedQuestion);

  if (!hasName && (useContext || hasPronoun)) {
    const lastName = extractEmployeeNameFromHistory(history);
    if (lastName) {
      normalizedQuestion = `${normalizedQuestion} for ${lastName}`;
    }
  }

  let sql;
  try {
    const ruleSql = buildRuleBasedSql(normalizedQuestion);
    if (ruleSql) {
      sql = ruleSql;
      console.log(`[SQL_CHAIN] Using rule-based SQL: ${sql}`);
    } else {
      sql = await generateSql(normalizedQuestion);
    }
  } catch (err) {
    console.warn("SQL generation failed:", err?.message || err);
    return {
      sql: "",
      rows: [],
      answer:
        "I couldn't generate a safe database query for that request. Please rephrase or narrow the question.",
    };
  }
  let rows = [];
  try {
    rows = await executeSql(sql);
  } catch (err) {
    console.warn("SQL execution failed:", err?.message || err);
    return {
      sql,
      rows: [],
      answer:
        "I couldn't run that database query safely. Please adjust the question or try a simpler one.",
    };
  }

  const enrichedRows = await enrichRowsWithEmployees(sql, rows);
  const answer = await formatAnswer(question || "", sql, enrichedRows);
  return { sql, answer, rows: enrichedRows };
}

export async function runSqlPage(previousSql, originalQuestion, offset, limit) {
  const pagedSql = applyLimitOffset(previousSql || "", limit, offset);
  if (!pagedSql) {
    return {
      sql: "",
      rows: [],
      answer:
        "I couldn't reuse the previous database query for pagination. Please ask your data question again.",
    };
  }

  let rows = [];
  try {
    rows = await executeSql(pagedSql);
  } catch (err) {
    console.warn("SQL execution failed (pagination):", err?.message || err);
    return {
      sql: pagedSql,
      rows: [],
      answer:
        "I couldn't fetch the next set of database results safely. Please try again or adjust the request.",
    };
  }

  const pageStart = Math.max(0, Number.isFinite(offset) ? offset : 0) + 1;
  const questionForAnswer = originalQuestion
    ? `${originalQuestion} (showing results starting from row ${pageStart})`
    : `Follow-up page of results starting from row ${pageStart}`;

  const enrichedRows = await enrichRowsWithEmployees(pagedSql, rows);
  const answer = await formatAnswer(questionForAnswer, pagedSql, enrichedRows);
  return { sql: pagedSql, answer, rows: enrichedRows };
}

