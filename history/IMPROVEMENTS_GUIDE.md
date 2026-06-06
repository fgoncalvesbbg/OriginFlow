# New Features & Improvements Guide

This document explains how to use the new features added to improve code quality, user experience, and developer productivity.

## 1. Toast Notifications 🔔

Toast notifications provide user feedback for actions (success, error, info, warning).

### Usage

```typescript
import { useToast } from '../hooks';

function MyComponent() {
  const toast = useToast();

  const handleSuccess = () => {
    toast.success('Operation completed successfully!');
  };

  const handleError = () => {
    toast.error('Something went wrong. Please try again.');
  };

  const handleInfo = () => {
    toast.info('This is an informational message', 7000); // Custom duration
  };

  return (
    <>
      <button onClick={handleSuccess}>Show Success</button>
      <button onClick={handleError}>Show Error</button>
      <button onClick={handleInfo}>Show Info</button>
    </>
  );
}
```

### Features

- Auto-dismiss after configurable duration (default: 5 seconds)
- Manual dismiss with close button
- 4 types: success, error, info, warning
- Smooth animations
- Stack multiple notifications

### In Error Handlers

```typescript
import { useToast } from '../hooks';

function CreateProject() {
  const toast = useToast();

  const handleCreateProject = async () => {
    try {
      await createProject(...);
      toast.success('Project created successfully!');
    } catch (error) {
      toast.error(error.message || 'Failed to create project');
    }
  };
}
```

---

## 2. Form Validation 📋

Comprehensive form validation with reusable validators and a custom `useForm` hook.

### Built-in Validators

```typescript
import {
  validateEmail,
  validatePassword,
  validateRequired,
  validateLength,
  validateNumber,
  validateFile,
  validateDate,
  validateFutureDate,
  combineValidations
} from '../utils';

// Email validation
validateEmail('user@example.com'); // true

// Password validation (returns { valid, errors })
const result = validatePassword('weak');
// { valid: false, errors: ['Password must be at least 8 characters', ...] }

// Required field
validateRequired(value, 'Project Name');

// Text length
validateLength(description, 10, 500, 'Description');

// Number range
validateNumberRange(quantity, 1, 1000, 'Quantity');

// File validation
validateFile(file, 10240, ['application/pdf', 'image/png']);

// Date validation
validateDate('2024-12-31');
validateFutureDate('2024-12-31', 'Deadline');

// Combine multiple validations
combineValidations(
  validateRequired(name, 'Name'),
  validateLength(name, 3, 100, 'Name')
);
```

### useForm Hook

```typescript
import { useForm } from '../hooks';
import { validateRequired, validateLength, validateEmail } from '../utils';

function CreateProjectForm() {
  const form = useForm({
    initialValues: {
      projectName: '',
      email: '',
      description: ''
    },
    validate: (values) => {
      const errors: FormFieldError = {};

      const nameValidation = validateRequired(values.projectName, 'Project Name');
      if (!nameValidation.valid) {
        errors.projectName = nameValidation.errors;
      }

      const lengthValidation = validateLength(values.projectName, 3, 100, 'Project Name');
      if (!lengthValidation.valid) {
        errors.projectName = [
          ...(errors.projectName || []),
          ...lengthValidation.errors
        ];
      }

      const emailValidation = validateRequired(values.email, 'Email');
      if (!emailValidation.valid) {
        errors.email = emailValidation.errors;
      } else if (!validateEmail(values.email)) {
        errors.email = ['Email is invalid'];
      }

      return errors;
    },
    onSubmit: async (values) => {
      await createProject(values);
    }
  });

  return (
    <form onSubmit={form.handleSubmit}>
      <div>
        <input
          type="text"
          name="projectName"
          value={form.values.projectName}
          onChange={form.handleChange}
          onBlur={form.handleBlur}
          className={form.touched.projectName && form.errors.projectName ? 'error' : ''}
        />
        {form.touched.projectName && form.errors.projectName && (
          <ul className="error-messages">
            {form.errors.projectName.map((err, i) => (
              <li key={i}>{err}</li>
            ))}
          </ul>
        )}
      </div>

      {form.errors.email && (
        <p className="error">{form.errors.email[0]}</p>
      )}

      <button type="submit" disabled={form.isSubmitting || form.hasErrors}>
        {form.isSubmitting ? 'Creating...' : 'Create Project'}
      </button>
    </form>
  );
}
```

### useForm Return Values

- `values`: Form field values
- `errors`: Validation errors by field
- `touched`: Which fields have been interacted with
- `isSubmitting`: Is form being submitted
- `setFieldValue()`: Programmatically set a field value
- `setFieldError()`: Programmatically set field errors
- `setFieldTouched()`: Mark field as interacted
- `handleChange()`: Connect to input onChange
- `handleBlur()`: Connect to input onBlur
- `handleSubmit()`: Connect to form onSubmit
- `resetForm()`: Reset to initial values
- `clearErrors()`: Clear all errors
- `hasErrors`: Boolean if any errors exist

---

## 3. Async Operations 🔄

The `useAsync` hook handles asynchronous operations with automatic loading and error states.

### Usage

```typescript
import { useAsync } from '../hooks';

function ProjectList() {
  const { data: projects, isLoading, error, execute, reset } = useAsync(
    () => getProjects(),
    true // immediate=true: fetch on mount
  );

  if (isLoading) return <div>Loading projects...</div>;
  if (error) return <div>Error: {error.message}</div>;

  return (
    <ul>
      {projects?.map(p => (
        <li key={p.id}>{p.name}</li>
      ))}
    </ul>
  );
}
```

### Manual Execution

```typescript
function SearchProjects() {
  const { data: results, execute, isLoading } = useAsync(
    () => searchProjects(query),
    false // immediate=false: don't fetch until we call execute()
  );

  const handleSearch = async () => {
    await execute();
  };

  return (
    <>
      <button onClick={handleSearch} disabled={isLoading}>
        {isLoading ? 'Searching...' : 'Search'}
      </button>
      {results && <ResultsList results={results} />}
    </>
  );
}
```

### Combining with Toasts

```typescript
function CreateProject() {
  const toast = useToast();
  const { execute: create, isLoading } = useAsync(
    async () => {
      const result = await createProject(formData);
      toast.success('Project created successfully!');
      return result;
    },
    false
  );

  const handleCreate = async () => {
    try {
      await create();
    } catch (error) {
      toast.error(error.message || 'Failed to create project');
    }
  };

  return <button onClick={handleCreate} disabled={isLoading}>Create</button>;
}
```

### useAsync Return Values

- `status`: 'idle' | 'pending' | 'success' | 'error'
- `data`: T | null
- `error`: Error | null
- `isLoading`: boolean
- `execute()`: Manually trigger the async function
- `reset()`: Reset to idle state

---

## 4. Error Boundaries 🛡️

Error boundaries catch React component errors and prevent app crash.

### Already Wrapped

The app is already wrapped with `<ErrorBoundary>` in App.tsx, but you can add more granular boundaries:

```typescript
import { ErrorBoundary } from '../components/common/ErrorBoundary';

function App() {
  return (
    <ErrorBoundary>
      <Dashboard />
    </ErrorBoundary>
  );
}

// Or with custom fallback
function SomeFeature() {
  return (
    <ErrorBoundary
      fallback={(error, retry) => (
        <div>
          <h2>Feature error: {error.message}</h2>
          <button onClick={retry}>Retry</button>
        </div>
      )}
    >
      <ComplexComponent />
    </ErrorBoundary>
  );
}
```

---

## 5. Complete Example: Create Project Form

Here's a complete example combining all features:

```typescript
import React from 'react';
import { useForm, useToast, useAsync } from '../hooks';
import {
  validateRequired,
  validateLength,
  validateEmail
} from '../utils';
import { createProject, getSuppliers } from '../services';

interface CreateProjectFormValues {
  projectName: string;
  projectId: string;
  supplierId: string;
  email: string;
}

function CreateProjectForm() {
  const toast = useToast();

  // Fetch suppliers
  const { data: suppliers, isLoading: suppliersLoading } = useAsync(
    () => getSuppliers(),
    true
  );

  // Form state
  const form = useForm<CreateProjectFormValues>({
    initialValues: {
      projectName: '',
      projectId: '',
      supplierId: '',
      email: ''
    },
    validate: (values) => {
      const errors: Record<string, string[]> = {};

      // Validate project name
      const nameValidation = validateRequired(values.projectName, 'Project Name');
      if (!nameValidation.valid) {
        errors.projectName = nameValidation.errors;
      } else {
        const lengthValidation = validateLength(values.projectName, 3, 100, 'Project Name');
        if (!lengthValidation.valid) {
          errors.projectName = lengthValidation.errors;
        }
      }

      // Validate project ID
      const idValidation = validateRequired(values.projectId, 'Project ID');
      if (!idValidation.valid) {
        errors.projectId = idValidation.errors;
      }

      // Validate supplier
      const supplierValidation = validateRequired(values.supplierId, 'Supplier');
      if (!supplierValidation.valid) {
        errors.supplierId = supplierValidation.errors;
      }

      // Validate email
      const emailValidation = validateRequired(values.email, 'Email');
      if (!emailValidation.valid) {
        errors.email = emailValidation.errors;
      }

      return errors;
    },
    onSubmit: async (values) => {
      try {
        await createProject(
          values.projectName,
          values.supplierId,
          values.projectId,
          values.email
        );
        toast.success('Project created successfully!');
        form.resetForm();
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : 'Failed to create project'
        );
      }
    }
  });

  if (suppliersLoading) {
    return <div className="p-4">Loading suppliers...</div>;
  }

  return (
    <form onSubmit={form.handleSubmit} className="space-y-4">
      <div>
        <label className="block font-semibold mb-1">Project Name *</label>
        <input
          type="text"
          name="projectName"
          value={form.values.projectName}
          onChange={form.handleChange}
          onBlur={form.handleBlur}
          className={`w-full border rounded px-3 py-2 ${
            form.touched.projectName && form.errors.projectName
              ? 'border-red-500 bg-red-50'
              : 'border-gray-300'
          }`}
          placeholder="Enter project name"
        />
        {form.touched.projectName && form.errors.projectName && (
          <div className="text-red-600 text-sm mt-1">
            {form.errors.projectName[0]}
          </div>
        )}
      </div>

      <div>
        <label className="block font-semibold mb-1">Project ID *</label>
        <input
          type="text"
          name="projectId"
          value={form.values.projectId}
          onChange={form.handleChange}
          onBlur={form.handleBlur}
          className={`w-full border rounded px-3 py-2 ${
            form.touched.projectId && form.errors.projectId
              ? 'border-red-500 bg-red-50'
              : 'border-gray-300'
          }`}
          placeholder="e.g., PROJ-001"
        />
      </div>

      <div>
        <label className="block font-semibold mb-1">Supplier *</label>
        <select
          name="supplierId"
          value={form.values.supplierId}
          onChange={form.handleChange}
          onBlur={form.handleBlur}
          className={`w-full border rounded px-3 py-2 ${
            form.touched.supplierId && form.errors.supplierId
              ? 'border-red-500 bg-red-50'
              : 'border-gray-300'
          }`}
        >
          <option value="">Select a supplier</option>
          {suppliers?.map(s => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      <button
        type="submit"
        disabled={form.isSubmitting || form.hasErrors}
        className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-semibold py-2 px-4 rounded transition-colors"
      >
        {form.isSubmitting ? 'Creating...' : 'Create Project'}
      </button>
    </form>
  );
}

export default CreateProjectForm;
```

---

## Summary

These improvements provide:

✅ **Better User Experience** - Clear feedback via toast notifications
✅ **Data Validation** - Comprehensive validation with helpful error messages
✅ **Cleaner Code** - useForm and useAsync reduce boilerplate
✅ **Error Handling** - Error boundaries prevent app crashes
✅ **Type Safety** - Full TypeScript support throughout

Start using these features in new code and gradually refactor existing pages!
