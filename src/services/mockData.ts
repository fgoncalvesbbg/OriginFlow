
import { 
  Project, 
  Supplier, 
  ProjectStep, 
  ProjectDocument, 
  ProjectOverallStatus, 
  StepStatus, 
  ResponsibleParty, 
  DocStatus,
  CategoryL3,
  ProductFeature,
  ComplianceRequirement,
  ComplianceRequest,
  ComplianceRequestStatus,
  User,
  UserRole
} from '../types';

export const MOCK_SUPPLIERS: Supplier[] = [
  { id: 's1', name: 'Shenzhen Tech Manufacturing', code: 'SUP-001', email: 'contact@shenzhentech.com', portalToken: 'portal-token-s1' },
  { id: 's2', name: 'Global Packaging Solutions', code: 'SUP-002', email: 'sales@globalpack.com', portalToken: 'portal-token-s2' },
  { id: 's3', name: 'Vietnam Textiles Co', code: 'SUP-003', email: 'info@vntextiles.com', portalToken: 'portal-token-s3' },
];

// Mock Users (Password for all is "password123")
export const MOCK_USERS: (User & { password: string })[] = [
  { 
    id: 'u1', 
    name: 'Alice Admin', 
    email: 'admin@example.com', 
    role: UserRole.PM,
    password: 'password123'
  },
  { 
    id: 'u2', 
    name: 'Bob Manager', 
    email: 'bob@example.com', 
    role: UserRole.PM,
    password: 'password123'
  }
];

export const INITIAL_PROJECTS: Project[] = [
  {
    id: 'p1',
    projectId: 'PRJ-2025-001',
    name: 'Smart Coffee Maker V2',
    supplierId: 's1',
    pmId: 'u1',
    currentStep: 2,
    status: ProjectOverallStatus.IN_PROGRESS,
    supplierLinkToken: 'token-coffee-123',
    createdAt: new Date().toISOString(),
  },
  {
    id: 'p2',
    projectId: 'PRJ-2025-002',
    name: 'Eco-Friendly Yoga Mat',
    supplierId: 's3',
    pmId: 'u1',
    currentStep: 1,
    status: ProjectOverallStatus.IN_PROGRESS,
    supplierLinkToken: 'token-yoga-456',
    createdAt: new Date().toISOString(),
  }
];

export const DEFAULT_STEPS = [
  { number: 1, name: 'RFQ' },
  { number: 2, name: 'Business Case & Development' },
  { number: 3, name: 'Production' },
];

export const generateStepsForProject = (projectId: string): ProjectStep[] => {
  return DEFAULT_STEPS.map(ds => ({
    id: `step-${projectId}-${ds.number}`,
    projectId,
    stepNumber: ds.number,
    name: ds.name,
    status: ds.number === 1 ? StepStatus.IN_PROGRESS : StepStatus.NOT_STARTED,
  }));
};

export const generateDocsForProject = (projectId: string): ProjectDocument[] => {
  const docs: ProjectDocument[] = [
    // Step 1 - RFQ
    {
      id: `doc-${projectId}-1`,
      projectId,
      stepNumber: 1,
      title: 'Klarstein RFQ',
      responsibleParty: ResponsibleParty.INTERNAL,
      isVisibleToSupplier: true,
      isRequired: true,
      status: DocStatus.UPLOADED,
      versions: [
        {
          id: 'v1',
          fileUrl: 'https://picsum.photos/200',
          uploadedAt: new Date(Date.now() - 86400000).toISOString(),
          uploadedBySupplier: false,
          versionNumber: 1
        }
      ]
    },
    {
      id: `doc-${projectId}-2`,
      projectId,
      stepNumber: 1,
      title: 'Supplier Quote',
      responsibleParty: ResponsibleParty.SUPPLIER,
      isVisibleToSupplier: true,
      isRequired: true,
      status: DocStatus.WAITING_UPLOAD,
      versions: []
    },
    {
      id: `doc-${projectId}-3`,
      projectId,
      stepNumber: 1,
      title: 'Others',
      responsibleParty: ResponsibleParty.INTERNAL,
      isVisibleToSupplier: true,
      isRequired: false,
      status: DocStatus.NOT_STARTED,
      versions: []
    },
    
    // Step 2 - Business Case & Development
    {
      id: `doc-${projectId}-4`,
      projectId,
      stepNumber: 2,
      title: '3D CAD Files',
      responsibleParty: ResponsibleParty.SUPPLIER,
      isVisibleToSupplier: true,
      isRequired: true,
      status: DocStatus.NOT_STARTED,
      versions: []
    },
    {
      id: `doc-${projectId}-5`,
      projectId,
      stepNumber: 2,
      title: 'Product Photos',
      responsibleParty: ResponsibleParty.SUPPLIER,
      isVisibleToSupplier: true,
      isRequired: true,
      status: DocStatus.NOT_STARTED,
      versions: []
    },
    {
      id: `doc-${projectId}-6`,
      projectId,
      stepNumber: 2,
      title: 'IM Draft',
      responsibleParty: ResponsibleParty.SUPPLIER,
      isVisibleToSupplier: true,
      isRequired: true,
      status: DocStatus.NOT_STARTED,
      versions: []
    },
    {
      id: `doc-${projectId}-7`,
      projectId,
      stepNumber: 2,
      title: 'Initial Design Specs',
      responsibleParty: ResponsibleParty.INTERNAL,
      isVisibleToSupplier: true,
      isRequired: true,
      status: DocStatus.NOT_STARTED,
      versions: []
    },
    {
      id: `doc-${projectId}-8`,
      projectId,
      stepNumber: 2,
      title: 'Others',
      responsibleParty: ResponsibleParty.INTERNAL,
      isVisibleToSupplier: true,
      isRequired: false,
      status: DocStatus.NOT_STARTED,
      versions: []
    },

    // Step 3 - Production
    {
      id: `doc-${projectId}-9`,
      projectId,
      stepNumber: 3,
      title: 'Final Design Specs',
      responsibleParty: ResponsibleParty.INTERNAL,
      isVisibleToSupplier: true,
      isRequired: true,
      status: DocStatus.NOT_STARTED,
      versions: []
    },
    {
      id: `doc-${projectId}-10`,
      projectId,
      stepNumber: 3,
      title: 'Final IM',
      responsibleParty: ResponsibleParty.SUPPLIER,
      isVisibleToSupplier: true,
      isRequired: true,
      status: DocStatus.NOT_STARTED,
      versions: []
    },
    {
      id: `doc-${projectId}-11`,
      projectId,
      stepNumber: 3,
      title: 'Packaging Guidelines',
      responsibleParty: ResponsibleParty.INTERNAL,
      isVisibleToSupplier: true,
      isRequired: true,
      status: DocStatus.NOT_STARTED,
      versions: []
    },
    {
      id: `doc-${projectId}-12`,
      projectId,
      stepNumber: 3,
      title: 'Others',
      responsibleParty: ResponsibleParty.INTERNAL,
      isVisibleToSupplier: true,
      isRequired: false,
      status: DocStatus.NOT_STARTED,
      versions: []
    },
  ];
  return docs;
};

// Initialize mock data for p1 and p2
export const INITIAL_STEPS = [...generateStepsForProject('p1'), ...generateStepsForProject('p2')];
export const INITIAL_DOCS = [...generateDocsForProject('p1'), ...generateDocsForProject('p2')];

// --- COMPLIANCE MOCK DATA ---

export const INITIAL_CATEGORIES: CategoryL3[] = [
  { id: 'cat1', name: 'Small Kitchen Appliances', active: true, isFinalized: false },
  { id: 'cat2', name: 'Personal Care (Hair)', active: true, isFinalized: true },
  { id: 'cat3', name: 'Toys (Battery Operated)', active: true, isFinalized: false },
];

export const INITIAL_FEATURES: ProductFeature[] = [
  { id: 'feat1', categoryId: 'cat1', name: 'Has WiFi', active: true },
  { id: 'feat2', categoryId: 'cat1', name: 'Has Bluetooth', active: true },
  { id: 'feat3', categoryId: 'cat1', name: 'Food Contact', active: true },
  { id: 'feat4', categoryId: 'cat3', name: 'Rechargeable Battery', active: true },
];

export const INITIAL_REQUIREMENTS: ComplianceRequirement[] = [
  {
    id: 'req1',
    categoryId: 'cat1',
    title: 'LVD (Low Voltage Directive) Test Report',
    description: 'Must provide a full test report according to EN 60335-1 and relevant part 2.',
    isMandatory: true,
    referenceCode: '2014/35/EU',
    appliesByDefault: true,
    conditionFeatureIds: []
  },
  {
    id: 'req2',
    categoryId: 'cat1',
    title: 'Food Contact Material Test (LFGB)',
    description: 'All parts touching food must be tested for migration.',
    isMandatory: true,
    referenceCode: 'EU 1935/2004',
    appliesByDefault: false,
    conditionFeatureIds: ['feat3'] // Only if Food Contact
  },
  {
    id: 'req3',
    categoryId: 'cat1',
    title: 'RED (Radio Equipment Directive) Declaration',
    description: 'Required for any device with radio communication (WiFi, BT).',
    isMandatory: true,
    referenceCode: '2014/53/EU',
    appliesByDefault: false,
    conditionFeatureIds: ['feat1', 'feat2'] // WiFi OR Bluetooth
  },
  {
    id: 'req4',
    categoryId: 'cat3',
    title: 'Toy Safety Directive (EN 71)',
    description: 'Mechanical and physical properties test.',
    isMandatory: true,
    referenceCode: '2009/48/EC',
    appliesByDefault: true,
    conditionFeatureIds: []
  }
];

export const INITIAL_COMPLIANCE_REQUESTS: ComplianceRequest[] = [
  {
    id: 'req-001',
    requestId: 'TCF-2025-001',
    projectId: 'p1',
    projectName: 'Smart Coffee Maker V2',
    supplierId: 's1',
    categoryId: 'cat1',
    features: [
      { featureId: 'feat1', value: true }, // WiFi
      { featureId: 'feat2', value: false },
      { featureId: 'feat3', value: true }, // Food Contact
    ],
    status: ComplianceRequestStatus.PENDING_SUPPLIER,
    responses: [],
    token: 'tcf-token-123',
    createdAt: new Date().toISOString()
  }
];
