# Fixing the Compliance Portal RPC Function Error

## Problem
When accessing the Compliance Portal through the supplier link, you're getting the error:
```
"structure of query does not match function result type"
```

This occurs because the Supabase RPC functions `get_compliance_request_secure` and `submit_compliance_response_secure` are not properly defined in your database.

## Root Cause
The code in `SupplierCompliancePortal.tsx` makes calls to two RPC functions:
1. `get_compliance_request_secure(token, accessCode)` - to retrieve the compliance request
2. `submit_compliance_response_secure(...)` - to submit the supplier's response

However, these functions are not defined or not correctly defined in your Supabase PostgreSQL database.

## Solution

### Step 1: Run the SQL Migration

1. Go to your Supabase Dashboard
2. Navigate to the **SQL Editor** section
3. Create a new query
4. Copy and paste the entire contents of `create_compliance_rpc_functions.sql`
5. Click **Run** to execute the migration

This will create:
- The `get_compliance_request_secure()` RPC function
- The `submit_compliance_response_secure()` RPC function
- Necessary permissions for the `anon` role (unauthenticated users accessing the portal)

### Step 2: Verify the Functions

After running the migration, verify the functions are created:

1. In Supabase, go to **SQL Editor**
2. Run this query:
```sql
SELECT routine_name, routine_type
FROM information_schema.routines
WHERE routine_name LIKE '%compliance%'
AND routine_schema = 'public';
```

You should see:
- `get_compliance_request_secure`
- `submit_compliance_response_secure`

### Step 3: Test the Portal

1. Try accessing the Compliance Portal using a TCF invitation link
2. Enter the 6-digit access code
3. You should now be able to access the compliance form without the error

## What These Functions Do

### `get_compliance_request_secure(p_token, p_code)`
- Takes a portal token and 6-digit access code
- Finds the matching compliance request in the database
- Returns the full compliance request including:
  - Request details (ID, project name, supplier, etc.)
  - Category and features
  - Previous responses (if any)
  - Status
  - Respondent information

### `submit_compliance_response_secure(p_token, p_code, p_responses, p_status, p_respondent_name, p_respondent_position)`
- Takes a portal token, access code, and the supplier's responses
- Securely validates the token/code combination
- Updates the compliance request with:
  - The responses array
  - The submission status
  - Respondent name and position
  - Submission timestamp
- Returns success/failure message

## Security Considerations

Both functions are created with `SECURITY DEFINER`, which means they execute with database owner permissions. This allows:
- Unauthenticated (anon) users to access them
- Secure token+code validation without exposing the database
- Protection against direct table manipulation

## Troubleshooting

### If you get a "permission denied" error:
Make sure the GRANT statements at the end of the SQL file were executed successfully.

### If the functions still aren't working:
1. Check that the `compliance_requests` table exists and has the correct columns
2. Make sure column names match exactly (snake_case):
   - `request_id`, `project_id`, `project_name`
   - `supplier_id`, `category_id`, `features`
   - `status`, `responses`, `token`, `access_code`
   - `created_at`, `submitted_at`, `completed_at`
   - `updated_by`, `deadline`, `change_log`
   - `respondent_name`, `respondent_position`

### If responses don't get stored:
The `updated_at` column might not exist. If so, either:
1. Add the column: `ALTER TABLE compliance_requests ADD COLUMN updated_at timestamptz DEFAULT NOW();`
2. Or remove the `updated_at` line from the UPDATE statement in the RPC function

## Additional Notes

- The functions use `LIMIT 1` to ensure only one request is returned (efficiency)
- Timestamps are automatically set using PostgreSQL's `NOW()` function
- All field mappings match the `mapComplianceRequest()` utility function in the frontend code
