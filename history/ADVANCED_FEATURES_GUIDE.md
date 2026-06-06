# Advanced Features Guide

This document covers the advanced features and hooks added for professional-grade UX and developer experience.

---

## 1. Modal/Dialog System 🔷

Complete modal management system for alerts, confirmations, and custom dialogs.

### Basic Usage

```typescript
import { useModal } from '../hooks';

function ProjectActions() {
  const modal = useModal();

  const handleDelete = () => {
    modal.confirm({
      title: 'Delete Project?',
      message: 'This action cannot be undone. All project data will be lost.',
      confirmText: 'Delete',
      cancelText: 'Cancel',
      isDangerous: true,
      onConfirm: async () => {
        await deleteProject(projectId);
      },
      onCancel: () => {
        console.log('Delete cancelled');
      }
    });
  };

  return <button onClick={handleDelete}>Delete Project</button>;
}
```

### Alert Dialog

```typescript
const modal = useModal();

modal.alert({
  title: 'Success',
  message: 'Project created successfully!',
  okText: 'OK',
  onOk: () => navigate('/projects')
});
```

### Confirm Dialog

```typescript
modal.confirm({
  title: 'Confirm Action',
  message: 'Are you sure you want to continue?',
  isDangerous: false,
  onConfirm: () => { /* action */ },
  onCancel: () => { /* cancel action */ }
});
```

### Custom Content

```typescript
modal.custom({
  title: 'Settings',
  content: <SettingsForm />,
  confirmText: 'Save',
  onConfirm: () => { /* save settings */ }
});
```

### Modal Options

```typescript
interface ModalOptions {
  title?: string;                    // Modal title
  message?: string;                  // Modal message
  content?: React.ReactNode;         // Custom content (overrides message)
  okText?: string;                   // OK button text
  cancelText?: string;               // Cancel button text
  isDangerous?: boolean;             // Red styling for dangerous actions
  onOk?: () => void | Promise<void>; // OK button callback
  onCancel?: () => void;             // Cancel button callback
  onClose?: () => void;              // Modal close callback
}
```

---

## 2. useConfirm Hook 🔷

Simplified hook specifically for confirmation dialogs.

### Usage

```typescript
import { useConfirm } from '../hooks';

function DeleteButton() {
  const confirm = useConfirm();

  const handleDelete = async () => {
    const confirmed = await confirm({
      title: 'Delete Item?',
      message: 'This cannot be undone.',
      onConfirm: async () => {
        await deleteItem();
      }
    });

    if (confirmed) {
      toast.success('Item deleted');
    }
  };

  return <button onClick={handleDelete}>Delete</button>;
}
```

### Promise-based

```typescript
const confirm = useConfirm();

const result = await confirm({
  title: 'Continue?',
  message: 'Proceed with this action?'
});

if (result) {
  // User confirmed
}
```

---

## 3. Loading Skeletons 🔷

Pre-built skeleton components for loading states.

### Generic Skeleton

```typescript
import { Skeleton } from '../components/common';

function ProfileCard() {
  const { data, isLoading } = useAsync(() => getProfile());

  if (isLoading) {
    return <Skeleton height={300} width="100%" radius={8} />;
  }

  return <ProfileCardContent profile={data} />;
}
```

### Text Skeleton

```typescript
import { TextSkeleton } from '../components/common';

function BlogPost() {
  const { data, isLoading } = useAsync(() => getBlogPost());

  return (
    <div>
      <h1>{isLoading ? <TextSkeleton width="60%" /> : data?.title}</h1>
      {isLoading && (
        <>
          <TextSkeleton count={3} />
        </>
      )}
    </div>
  );
}
```

### Card Skeleton

```typescript
import { CardSkeleton } from '../components/common';

function ProjectList() {
  const { data: projects, isLoading } = useAsync(() => getProjects());

  return (
    <div className="grid gap-4">
      {isLoading ? (
        <>
          <CardSkeleton lines={3} />
          <CardSkeleton lines={3} />
          <CardSkeleton lines={3} />
        </>
      ) : (
        projects?.map(p => <ProjectCard project={p} />)
      )}
    </div>
  );
}
```

### Available Skeletons

- `Skeleton` - Generic skeleton with custom dimensions
- `TextSkeleton` - For text content
- `AvatarSkeleton` - Round avatar image
- `CardSkeleton` - Full card with header, content, footer
- `TableSkeleton` - Table rows with columns
- `ImageSkeleton` - Image placeholder with aspect ratio
- `ButtonSkeleton` - Button-sized placeholder
- `ListSkeleton` - List of items with avatars

### Custom Skeleton

```typescript
import { Skeleton } from '../components/common';

function CustomLoader() {
  return (
    <div className="space-y-4">
      <div className="flex gap-3">
        <Skeleton height={40} width={40} radius={20} />
        <div className="flex-1 space-y-2">
          <Skeleton height={16} width="70%" />
          <Skeleton height={12} width="100%" />
        </div>
      </div>
    </div>
  );
}
```

---

## 4. useDebounce Hook 🔷

Delays updating a value until after a specified delay with no changes.

### Search Example

```typescript
import { useDebounce } from '../hooks';

function ProjectSearch() {
  const [searchTerm, setSearchTerm] = useState('');
  const debouncedTerm = useDebounce(searchTerm, 500); // Wait 500ms

  const { data: results } = useAsync(
    () => searchProjects(debouncedTerm),
    true
  );

  return (
    <>
      <input
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
        placeholder="Search projects..."
      />
      {results?.map(p => (
        <SearchResult key={p.id} project={p} />
      ))}
    </>
  );
}
```

### Filter Example

```typescript
function AdvancedSearch() {
  const [filters, setFilters] = useState({ status: '', category: '' });
  const debouncedFilters = useDebounce(filters, 800);

  const { data: results } = useAsync(
    () => applyFilters(debouncedFilters),
    true
  );

  return (
    <>
      <FilterPanel filters={filters} onChange={setFilters} />
      <ResultsList results={results} />
    </>
  );
}
```

### Parameters

- `value: T` - Value to debounce
- `delay: number` - Delay in milliseconds (default: 500)

---

## 5. useLocalStorage Hook 🔷

Syncs state with browser localStorage for persistence.

### Form Draft Auto-save

```typescript
import { useLocalStorage } from '../hooks';

function EditProjectForm() {
  const [formData, setFormData] = useLocalStorage('projectFormDraft', {
    name: '',
    description: '',
    deadline: ''
  });

  const handleChange = (e) => {
    setFormData(prev => ({
      ...prev,
      [e.target.name]: e.target.value
    }));
  };

  const handleSubmit = async () => {
    await saveProject(formData);
    // Clear the draft after successful save
    setFormData({});
  };

  return (
    <form onSubmit={handleSubmit}>
      <input name="name" value={formData.name} onChange={handleChange} />
      <textarea
        name="description"
        value={formData.description}
        onChange={handleChange}
      />
      <button type="submit">Save Project</button>
    </form>
  );
}
```

### User Preferences

```typescript
function AppSettings() {
  const [theme, setTheme] = useLocalStorage('theme', 'light');
  const [sidebarCollapsed, setSidebarCollapsed] = useLocalStorage('sidebarCollapsed', false);

  return (
    <>
      <select value={theme} onChange={(e) => setTheme(e.target.value)}>
        <option>light</option>
        <option>dark</option>
      </select>
      <button onClick={() => setSidebarCollapsed(!sidebarCollapsed)}>
        Toggle Sidebar
      </button>
    </>
  );
}
```

### API

```typescript
const [value, setValue] = useLocalStorage(key, initialValue);

// Set value directly
setValue(newValue);

// Set value with function (like useState)
setValue(prev => ({ ...prev, field: newValue }));

// Clear by setting to null
setValue(null);
```

---

## 6. useClickOutside Hook 🔷

Detects clicks outside a specified element. Useful for closing dropdowns, modals, etc.

### Dropdown Menu

```typescript
import { useClickOutside } from '../hooks';

function Dropdown() {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useClickOutside<HTMLDivElement>(() => setIsOpen(false));

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setIsOpen(!isOpen)}>Menu</button>
      {isOpen && (
        <div className="absolute mt-2 bg-white border rounded shadow">
          <a href="/profile">Profile</a>
          <a href="/settings">Settings</a>
          <a href="/logout">Logout</a>
        </div>
      )}
    </div>
  );
}
```

### Popover

```typescript
function Popover() {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useClickOutside<HTMLDivElement>(() => setIsOpen(false));

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setIsOpen(!isOpen)}>Show Popover</button>
      {isOpen && (
        <div className="absolute bg-white border rounded p-4 shadow-lg">
          <PopoverContent />
        </div>
      )}
    </div>
  );
}
```

### Parameters

- `callback: () => void` - Function to call when click detected outside
- Returns: `RefObject<T>` - Ref to attach to the container element

---

## Complete Example: Advanced Project Management

Here's a complete example combining multiple features:

```typescript
import React, { useState } from 'react';
import {
  useModal,
  useConfirm,
  useDebounce,
  useLocalStorage,
  useAsync,
  useToast,
  useClickOutside
} from '../hooks';
import { CardSkeleton } from '../components/common';
import { deleteProject, getProjects, updateProject } from '../services';

function ProjectManagement() {
  const toast = useToast();
  const modal = useModal();
  const confirm = useConfirm();

  // Search with debounce
  const [searchTerm, setSearchTerm] = useState('');
  const debouncedTerm = useDebounce(searchTerm, 500);

  // Filters with local storage
  const [filters, setFilters] = useLocalStorage('projectFilters', {
    status: 'all',
    category: 'all'
  });

  // Dropdown menu with click outside
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useClickOutside<HTMLDivElement>(() => setMenuOpen(false));

  // Fetch projects
  const { data: projects, isLoading, execute: refetch } = useAsync(
    () => getProjects(debouncedTerm, filters),
    true
  );

  const handleEdit = (project: any) => {
    modal.custom({
      title: 'Edit Project',
      content: <EditProjectForm project={project} />,
      confirmText: 'Save',
      onConfirm: async () => {
        await updateProject(project.id, { ...project });
        toast.success('Project updated');
        refetch();
      }
    });
  };

  const handleDelete = async (projectId: string) => {
    const confirmed = await confirm({
      title: 'Delete Project?',
      message: 'This action cannot be undone.',
      isDangerous: true,
      onConfirm: async () => {
        await deleteProject(projectId);
        toast.success('Project deleted');
        refetch();
      }
    });
  };

  return (
    <div className="space-y-4">
      {/* Search */}
      <input
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
        placeholder="Search projects..."
        className="w-full px-4 py-2 border rounded"
      />

      {/* Filters */}
      <div ref={menuRef} className="relative">
        <button onClick={() => setMenuOpen(!menuOpen)}>
          Filters
        </button>
        {menuOpen && (
          <div className="absolute bg-white border rounded shadow p-2">
            <select
              value={filters.status}
              onChange={(e) =>
                setFilters({ ...filters, status: e.target.value })
              }
            >
              <option value="all">All Status</option>
              <option value="active">Active</option>
              <option value="completed">Completed</option>
            </select>
          </div>
        )}
      </div>

      {/* Projects List */}
      <div className="space-y-2">
        {isLoading ? (
          <>
            <CardSkeleton />
            <CardSkeleton />
            <CardSkeleton />
          </>
        ) : (
          projects?.map(project => (
            <div key={project.id} className="bg-white p-4 rounded border">
              <div className="flex justify-between">
                <div>
                  <h3 className="font-bold">{project.name}</h3>
                  <p className="text-gray-600 text-sm">{project.description}</p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleEdit(project)}
                    className="text-blue-600"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(project.id)}
                    className="text-red-600"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default ProjectManagement;
```

---

## Hook Usage Summary

| Hook | Purpose | Example |
|------|---------|---------|
| `useModal()` | Show modals/dialogs | Confirmations, alerts |
| `useConfirm()` | Quick confirm dialogs | Delete actions |
| `useDebounce()` | Delay value updates | Search input |
| `useLocalStorage()` | Persist to localStorage | Form drafts |
| `useClickOutside()` | Detect outside clicks | Dropdowns, popovers |
| `useAsync()` | Handle async operations | Data fetching |
| `useForm()` | Manage form state | Form validation |
| `useToast()` | Show notifications | User feedback |

---

## Best Practices

1. **Always wrap modals with error handling**
   ```typescript
   modal.confirm({
     onConfirm: async () => {
       try {
         await deleteProject();
         toast.success('Deleted');
       } catch (error) {
         toast.error(error.message);
         throw error; // Re-throw to keep modal loading state
       }
     }
   });
   ```

2. **Combine debounce with async for search**
   ```typescript
   const debouncedTerm = useDebounce(searchTerm, 500);
   const { data } = useAsync(() => search(debouncedTerm), true);
   ```

3. **Use skeletons while loading**
   ```typescript
   {isLoading ? <CardSkeleton /> : <Card data={data} />}
   ```

4. **Auto-save form drafts**
   ```typescript
   const [draft, saveDraft] = useLocalStorage('formDraft', {});
   // Save on every change, restore on mount
   ```

5. **Always provide loading states**
   - Use `isLoading` from `useAsync`
   - Disable buttons during operations
   - Show skeletons for data

---

## Summary

These features provide:

✅ Professional modal dialogs with confirmation support
✅ Improved perceived performance with skeletons
✅ Debounced search for better UX and reduced API calls
✅ Auto-save functionality via localStorage
✅ Better dropdown/menu UX with click-outside detection
✅ Clean, reusable patterns for common UI patterns

Start integrating these into your pages for a more polished application!
