/**
 * Small, hand-crafted fixtures shared by the diagrams and report tests.
 * Deliberately tiny (a handful of files, one endpoint, one data model) but
 * realistic enough to exercise directory-grouping, external-dependency
 * folding, component-name matching, and the ER-diagram fallback path.
 */
import type {
  ApiEndpoint,
  ArchitectureImpactReport,
  ArchitectureInventory,
  AnalysisResult,
  DataModel,
  DependencyGraph,
  RepoInventory,
} from '../../types/index.js';
import { generateDiagrams } from '../index.js';

const files = [
  'src/api/userRoutes.ts',
  'src/api/server.ts',
  'src/rag/embed.ts',
  'src/rag/vectorStore.ts',
  'src/models/user.ts',
];

const repo: RepoInventory = {
  rootPath: '/repo/sample-app',
  files: files.map((relPath) => ({
    relPath,
    absPath: `/repo/sample-app/${relPath}`,
    language: 'typescript' as const,
    sizeBytes: 1024,
  })),
  projectType: 'node',
  packageManifests: ['package.json'],
};

const dependencyGraph: DependencyGraph = {
  nodes: files.map((relPath) => ({ id: relPath, relPath, exports: [] })),
  edges: [
    { from: 'src/api/userRoutes.ts', to: 'src/api/server.ts', kind: 'import' },
    { from: 'src/api/server.ts', to: 'src/rag/vectorStore.ts', kind: 'import' },
    { from: 'src/rag/vectorStore.ts', to: 'src/rag/embed.ts', kind: 'import' },
    { from: 'src/models/user.ts', to: 'src/api/userRoutes.ts', kind: 'import' },
    { from: 'src/rag/embed.ts', to: '@google/generative-ai', kind: 'external' },
    { from: 'src/api/server.ts', to: 'express', kind: 'external' },
  ],
};

const apiEndpoints: ApiEndpoint[] = [
  {
    method: 'GET',
    path: '/api/users',
    handlerFile: 'src/api/userRoutes.ts',
    handlerLine: 12,
    framework: 'express',
  },
];

const dataModels: DataModel[] = [
  {
    name: 'User',
    sourceFile: 'src/models/user.ts',
    fields: [
      { name: 'id', type: 'string' },
      { name: 'email', type: 'string' },
      { name: 'createdAt', type: 'Date' },
    ],
    kind: 'orm-model',
  },
];

export const sampleInventory: ArchitectureInventory = {
  repo,
  dependencyGraph,
  apiEndpoints,
  dataModels,
};

export const sampleReport: ArchitectureImpactReport = {
  summary:
    'The proposal adds a "favorite items" feature, requiring a new API endpoint, ' +
    'a new FavoritesService component, and a new database table to persist favorites per user.',
  affectedComponents: [
    { name: 'userRoutes.ts', reason: 'Needs a new route to expose favorites to clients.' },
    { name: 'User', reason: 'The User model gains a relation to favorites.' },
  ],
  affectedApis: [
    { endpoint: 'GET /api/users', impact: 'Response will optionally include favorite item ids.' },
  ],
  databaseChanges: [
    {
      description:
        'Add a new "favorites" table linked to the User model to store favorited item ids.',
      migrationNotes: 'Create table favorites(id, user_id FK, item_id, created_at).',
    },
  ],
  newComponents: [
    { name: 'FavoritesService', purpose: 'Encapsulates create/list/delete logic for user favorites.' },
  ],
  scalabilityRisks: [
    {
      risk: 'Unbounded favorites list per user could grow large and slow down list queries.',
      severity: 'medium',
      mitigation: 'Paginate the favorites list endpoint and add an index on user_id.',
    },
  ],
  securityConcerns: [
    {
      concern: 'Favorites endpoints must verify the requesting user owns the favorite before deleting it.',
      severity: 'high',
      mitigation: 'Add an authorization check comparing session user id to the favorite row owner.',
    },
  ],
  recommendedSteps: [
    'Design the favorites table schema and write the migration.',
    'Implement FavoritesService with create/list/delete methods.',
    'Add GET/POST/DELETE /api/favorites routes.',
    'Update GET /api/users to include favorite ids.',
  ],
};

/** Same report, but with no database changes — used to test the ER-diagram omission path. */
export const sampleReportNoDbChanges: ArchitectureImpactReport = {
  ...sampleReport,
  databaseChanges: [],
};

export const sampleDiagrams = generateDiagrams(sampleInventory, sampleReport);

export const sampleResult: AnalysisResult = {
  inventory: sampleInventory,
  proposal: {
    description: 'Allow users to mark items as favorites and view their favorites list.',
  },
  retrievedContext: [
    {
      chunk: {
        id: 'src/api/userRoutes.ts:1-50',
        relPath: 'src/api/userRoutes.ts',
        startLine: 1,
        endLine: 50,
        content: "router.get('/api/users', ...)",
      },
      score: 0.87,
    },
  ],
  report: sampleReport,
  diagrams: sampleDiagrams,
};
