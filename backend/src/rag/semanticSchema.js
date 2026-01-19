export const semanticSchema = {

  /* =========================
     CORE HR ENTITIES
  ==========================*/

  employees: {
    entity: "Employee",
    description: "All employees working in the organization including personal, contact, employment, and salary-related information",
    table: "employees",
    primaryKey: "id",

    synonyms: [
      "employee",
      "employees",
      "staff",
      "staff member",
      "team member",
      "worker",
      "personnel",
      "company employee",
      "employee record",
    ],

    columns: {
      id: "Primary internal employee identifier",
      attendance_device_id: "Biometric or attendance machine ID used for attendance tracking",
      employee_name: "Full name of the employee",
      employee_image: "Profile image or photo of the employee",
      personal_contact_number: "Employee personal phone number",
      emergency_contact_number: "Emergency contact number of employee",
      cnic: "National identity number of employee",
      personal_email: "Personal email address of employee",
      education: "Educational qualification of employee",
      employee_address: "Residential address of employee",
      office_email: "Official company email address",
      password: "Employee login password (hashed)",
      department: "Department data stored in JSON format",
      designation: "Job title or designation of employee",
      line_manager: "Reporting manager name or identifier",
      date_of_birth: "Date of birth of employee",
      joining_date: "Date when employee joined the company",
      exit_date: "Date employee exited the organization",
      exit_reason: "Reason for employee exit (JSON)",
      current_salary: "Current salary amount of employee",
      notes: "Additional notes or remarks",
      is_visible: "Visibility flag for employee record",
      is_active: "Employee active or inactive status",
      marital_status: "Marital status of employee",
      bank_status: "Whether bank details are added",
      allowance_status: "Whether allowances are enabled",
      resignation_at: "Timestamp when employee resigned",
      employment_type: "Employment type (full-time, part-time, contract)",
      employment_type_changed_at: "Last employment type change timestamp",
      notice_period: "Notice period duration in days",
      created_at: "Record creation timestamp",
      updated_at: "Record update timestamp",
    },

    relations: {
      attendances: {
        table: "attendances",
        join: "employees.attendance_device_id = attendances.attendance_device_id",
        description: "Employee attendance records",
      },
      bank_info: {
        table: "bank_info",
        join: "employees.id = bank_info.employee_id",
        description: "Employee bank details",
      },
      leaves: {
        table: "employee_leaves",
        join: "employees.id = employee_leaves.employee_id",
        description: "Employee leave balances",
      },
      requested_leaves: {
        table: "requested_leaves",
        join: "employees.id = requested_leaves.employee_id",
        description: "Employee leave requests",
      },
      allowances: {
        table: "employee_allowances",
        join: "employees.id = employee_allowances.employee_id",
        description: "Employee allowances",
      },
      salary_records: {
        table: "employee_salary_records",
        join: "employees.id = employee_salary_records.employee_id",
        description: "Employee salary history",
      },
      dependents: {
        table: "employee_dependent",
        join: "employees.id = employee_dependent.employee_id",
        description: "Employee dependents",
      },
      documents: {
        table: "employee_documents",
        join: "employees.id = employee_documents.employee_id",
        description: "Employee uploaded documents",
      },
      roles: {
        table: "employee_roles",
        join: "employees.id = employee_roles.employee_id",
        description: "Roles assigned to employee",
      },
    },
  },

  /* =========================
     ATTENDANCE
  ==========================*/

  attendances: {
    entity: "Attendance",
    description: "Employee attendance records including check-in and check-out information",
    table: "attendances",
    primaryKey: "id",

    synonyms: [
      "attendance",
      "attendances",
      "check in",
      "check out",
      "clock in",
      "clock out",
      "punch",
      "biometric entry",
      "attendance record",
    ],

    columns: {
      id: "Attendance record ID",
      employee_id: "Employee internal reference",
      attendance_device_id: "Biometric device ID",
      leave_type_id: "Associated leave type if on leave",
      check_in: "Employee check-in time",
      check_out: "Employee check-out time",
      date: "Attendance date",
      check_out_date: "Date of check-out",
      status: "Attendance status (present, absent, leave)",
      reason: "Reason for absence or leave",
      is_active: "Attendance active status",
      created_at: "Record creation time",
      updated_at: "Record update time",
    },

    relations: {
      employee: {
        table: "employees",
        join: "attendances.attendance_device_id = employees.attendance_device_id",
        description: "Employee linked to attendance",
      },
      leave_type: {
        table: "leave_types",
        join: "attendances.leave_type_id = leave_types.id",
        description: "Leave type used in attendance",
      },
    },
  },

  /* =========================
     LEAVES
  ==========================*/

  employee_leaves: {
    entity: "Employee Leave Balance",
    description: "Annual leave balance assigned to employees",
    table: "employee_leaves",

    synonyms: [
      "leave",
      "leaves",
      "leave balance",
      "remaining leaves",
      "total leaves",
      "time off",
    ],

    columns: {
      employee_id: "Employee reference",
      leave_type_id: "Leave type identifier",
      total_leaves: "Total leaves allocated",
      remaining_leaves: "Remaining leaves",
      year: "Leave year",
      is_active: "Active status",
    },

    relations: {
      employee: {
        table: "employees",
        join: "employee_leaves.employee_id = employees.id",
      },
      leave_type: {
        table: "leave_types",
        join: "employee_leaves.leave_type_id = leave_types.id",
      },
    },
  },

  requested_leaves: {
    entity: "Leave Request",
    description: "Leave requests submitted by employees",
    table: "requested_leaves",

    synonyms: [
      "leave request",
      "requested leave",
      "applied leave",
      "leave application",
    ],

    columns: {
      employee_id: "Employee requesting leave",
      leave_type_id: "Leave category",
      start_from: "Leave start date",
      to_end: "Leave end date",
      total_leaves: "Number of leave days",
      status: "Approval status (Pending, Approved, Rejected)",
      employee_reason: "Reason provided by employee",
      approval_reason: "Reason provided by approver",
    },
  },

  leave_types: {
    entity: "Leave Type",
    description: "Different types of leaves offered by company",
    table: "leave_types",

    synonyms: [
      "leave type",
      "casual leave",
      "sick leave",
      "annual leave",
    ],

    columns: {
      leave_name: "Name of leave",
      total_leaves: "Default total leaves",
      is_active: "Active status",
    },
  },

  /* =========================
     SALARY & ALLOWANCES
  ==========================*/

  employee_salary_records: {
    entity: "Salary History",
    description: "Salary changes and increments of employees",
    table: "employee_salary_records",

    synonyms: [
      "salary",
      "salary history",
      "pay",
      "increment",
      "compensation",
    ],

    columns: {
      employee_id: "Employee reference",
      previous_salary: "Previous salary amount",
      increment_amount: "Increment value",
      is_active: "Active record",
    },
  },

  employee_allowances: {
    entity: "Employee Allowance",
    description: "Allowances assigned to employees",
    table: "employee_allowances",

    synonyms: [
      "allowance",
      "allowances",
      "benefits",
      "extra pay",
    ],

    columns: {
      employee_id: "Employee reference",
      allowance_type: "Type of allowance",
      payment_type: "Payment frequency",
      amount: "Allowance amount",
    },
  },

  allowances: {
    entity: "Allowance Type",
    description: "Master list of allowance types",
    table: "allowances",

    synonyms: [
      "allowance type",
      "allowance master",
    ],

    columns: {
      allowance_type: "Allowance category name",
      is_active: "Active status",
    },
  },

  allowance_items: {
    entity: "Allowance Item",
    description: "Allowance items and descriptions",
    table: "allowance_items",

    synonyms: [
      "allowance item",
      "benefit item",
    ],

    columns: {
      allowance_item: "Allowance item name",
      allowance_description: "Item description",
      allowance_amount: "Default amount",
    },
  },

  allowance_details: {
    entity: "Allowance Detail",
    description: "Mapping of allowance types and items",
    table: "allowance_details",

    synonyms: [
      "allowance detail",
      "allowance mapping",
    ],

    columns: {
      allowance_type_id: "Allowance type reference",
      allowance_item_id: "Allowance item reference",
      allowance_amount: "Allowance amount",
    },
  },

  /* =========================
     ORG STRUCTURE
  ==========================*/

  departments: {
    entity: "Department",
    description: "Company departments",
    table: "departments",

    synonyms: [
      "department",
      "departments",
      "team",
      "division",
    ],

    columns: {
      department_name: "Name of department",
      description: "Department description",
      is_active: "Active status",
    },
  },

  employment_types: {
    entity: "Employment Type",
    description: "Employment categories",
    table: "employment_types",

    synonyms: [
      "employment type",
      "job type",
      "contract type",
    ],

    columns: {
      employee_type: "Employment category name",
    },
  },

  /* =========================
     ACCESS CONTROL
  ==========================*/

  roles: {
    entity: "Role",
    description: "Roles defined in system",
    table: "roles",

    synonyms: [
      "role",
      "roles",
      "designation role",
    ],

    columns: {
      role_name: "Role name",
      description: "Role description",
      permission_ids: "Permissions linked to role",
    },
  },

  permissions: {
    entity: "Permission",
    description: "System permissions",
    table: "permissions",

    synonyms: [
      "permission",
      "permissions",
      "access",
      "rights",
    ],

    columns: {
      module: "System module",
      permission: "Permission name",
      route: "Frontend or backend route",
      method: "HTTP method",
    },
  },

  employee_roles: {
    entity: "Employee Role",
    description: "Role assignments for employees",
    table: "employee_roles",

    synonyms: [
      "employee role",
      "user role",
    ],

    columns: {
      employee_id: "Employee reference",
      role_id: "Role reference",
    },
  },

  role_permissions: {
    entity: "Role Permission",
    description: "Permissions assigned directly to employees",
    table: "role_permissions",
  },

  /* =========================
     SUPPORTING TABLES
  ==========================*/

  activity_logs: {
    entity: "Activity Log",
    description: "Audit trail of system activities",
    table: "activity_logs",

    synonyms: [
      "activity log",
      "audit log",
      "system log",
    ],

    columns: {
      user_id: "User performing action",
      module: "Module name",
      action: "Performed action",
      record_id: "Affected record",
      created_at: "Action timestamp",
    },
  },

  public_holidays: {
    entity: "Public Holiday",
    description: "Official public holidays",
    table: "public_holidays",

    synonyms: [
      "holiday",
      "public holiday",
      "company holiday",
    ],

    columns: {
      holiday_date: "Holiday date",
      name: "Holiday name",
    },
  },

  

};

export const ENTITY_KEYWORDS = [
  // Employees
  "employee",
  "employees",
  "staff",
  "staff member",
  "team member",
  "personnel",
  "worker",
  "employee record",
  "employee details",

  // Attendance
  "attendance",
  "attendances",
  "check in",
  "check-in",
  "check out",
  "check-out",
  "punch",
  "clock in",
  "clock out",
  "working hours",
  "presence",

  // Attendance device
  "attendance device",
  "biometric device",
  "device id",
  "attendance device id",
  "attendance machine",

  // Departments
  "department",
  "departments",
  "team",
  "division",
  "unit",

  // Leaves
  "leave",
  "leaves",
  "employee leave",
  "leave balance",
  "remaining leaves",
  "total leaves",
  "time off",
  "paid leave",
  "unpaid leave",
  "annual leave",
  "sick leave",

  // Leave types
  "leave type",
  "leave category",
  "leave categories",

  // Salary
  "salary",
  "salaries",
  "current salary",
  "previous salary",
  "pay",
  "compensation",
  "increment",
  "salary increment",

  // Allowances
  "allowance",
  "allowances",
  "employee allowance",
  "benefits",
  "extra pay",
  "allowance amount",
  "allowance type",

  // Roles
  "role",
  "roles",
  "employee role",
  "user role",
  "designation role",

  // Permissions
  "permission",
  "permissions",
  "access",
  "access rights",
  "module permission",
  "api permission",
  "route permission",

  // Public holidays
  "public holiday",
  "public holidays",
  "holiday",
  "holidays",
  "official holiday",

  // Bank info
  "bank",
  "bank info",
  "bank information",
  "bank account",
  "salary account",

  // Employee documents
  "employee document",
  "employee documents",
  "documents",
  "files",
  "attachments",

  // Employee dependents
  "dependent",
  "dependents",
  "family member",
  "employee dependent",

  // Employment types
  "employment type",
  "employment types",
  "full time",
  "part time",
  "contract",
  "intern",

  // Activity logs
  "activity log",
  "activity logs",
  "audit log",
  "audit trail",
  "system log",
  "user activity",
];


export const FIELD_KEYWORDS = [
  // Identifiers
  "employee id",
  "id",
  "record id",

  // Employee identity
  "employee name",
  "name",
  "full name",

  // Contact
  "contact number",
  "phone",
  "phone number",
  "mobile",
  "mobile number",
  "personal contact number",
  "emergency contact",
  "emergency contact number",
  "email",
  "office email",
  "personal email",

  // Address
  "address",
  "employee address",

  // Employment info
  "designation",
  "job title",
  "position",
  "department",
  "joining date",
  "join date",
  "exit date",
  "resignation date",
  "employment status",
  "active",
  "inactive",

  // Salary fields
  "current salary",
  "previous salary",
  "increment amount",
  "salary amount",

  // Attendance fields
  "date",
  "attendance date",
  "check in time",
  "check out time",
  "working time",
  "status",
  "present",
  "absent",

  // Leave fields
  "leave year",
  "remaining leave",
  "remaining leaves",
  "total leave",
  "total leaves",

  // Allowance fields
  "allowance amount",
  "payment type",
  "monthly allowance",
  "one time allowance",

  // Permission fields
  "module",
  "api endpoint",
  "route",
  "method",

  // Logs
  "action",
  "created at",
  "activity time",
];

export const SQL_ACTION_KEYWORDS = [
  "list",
  "show",
  "get",
  "fetch",
  "display",
  "give",
  "find",
  "view",
  "retrieve",

  "count",
  "how many",
  "total number",
  "number of",

  "latest",
  "recent",
  "today",
  "this month",
  "this year",

  "remaining",
  "balance",
  "history",
  "records",
];

export const RAG_KEYWORDS = [
  "policy",
  "policies",
  "company policy",
  "leave policy",
  "attendance policy",

  "procedure",
  "process",
  "workflow",
  "guidelines",
  "rules",

  "onboarding",
  "offboarding",
  "hr policy",

  "product",
  "products",
  "service",
  "services",

  "company info",
  "about company",
  "convier solutions",
  "organization info",
];


export const STRUCTURED_KEYWORDS = [
  ...ENTITY_KEYWORDS,
  ...FIELD_KEYWORDS,
  ...SQL_ACTION_KEYWORDS,
];

