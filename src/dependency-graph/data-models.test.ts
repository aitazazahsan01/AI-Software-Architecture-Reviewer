import { describe, expect, it, beforeAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanRepo } from '../ingestion/scan.js';
import { extractDataModels } from './data-models.js';
import type { DataModel, RepoInventory } from '../types/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE_REPO = path.join(__dirname, 'fixtures', 'sample-repo');

describe('extractDataModels', () => {
  let inventory: RepoInventory;
  let models: DataModel[];

  beforeAll(async () => {
    inventory = await scanRepo(SAMPLE_REPO);
    models = await extractDataModels(inventory);
  });

  it('detects a Mongoose schema, naming it from mongoose.model(...)', () => {
    const user = models.find((m) => m.sourceFile === 'src/models/user.model.js');
    expect(user).toBeDefined();
    expect(user?.name).toBe('User');
    expect(user?.kind).toBe('schema');
    expect(user?.fields).toEqual(
      expect.arrayContaining([
        { name: 'name', type: 'String' },
        { name: 'email', type: 'String' },
        { name: 'age', type: 'Number' },
      ])
    );
  });

  it('detects a TypeORM @Entity() class', () => {
    const order = models.find((m) => m.name === 'Order');
    expect(order).toBeDefined();
    expect(order?.kind).toBe('orm-model');
    expect(order?.sourceFile).toBe('src/models/order.entity.js');
    expect(order?.fields.map((f) => f.name)).toEqual(
      expect.arrayContaining(['id', 'status', 'total'])
    );
  });

  it('detects a Sequelize .define(...) model', () => {
    const product = models.find((m) => m.name === 'Product');
    expect(product).toBeDefined();
    expect(product?.kind).toBe('orm-model');
    expect(product?.fields).toEqual(
      expect.arrayContaining([
        { name: 'name', type: 'DataTypes.STRING' },
        { name: 'price', type: 'DataTypes.FLOAT' },
      ])
    );
  });

  it('detects a Prisma model block', () => {
    const customer = models.find((m) => m.name === 'Customer');
    expect(customer).toBeDefined();
    expect(customer?.kind).toBe('schema');
    expect(customer?.sourceFile).toBe('src/schema.prisma');
    expect(customer?.fields).toEqual(
      expect.arrayContaining([
        { name: 'id', type: 'Int' },
        { name: 'email', type: 'String' },
      ])
    );
  });

  it('detects a raw CREATE TABLE statement in a .sql file', () => {
    const invoices = models.find((m) => m.name === 'invoices');
    expect(invoices).toBeDefined();
    expect(invoices?.kind).toBe('sql-table');
    expect(invoices?.sourceFile).toBe('src/schema.sql');
    expect(invoices?.fields).toEqual(
      expect.arrayContaining([
        { name: 'id', type: 'INT' },
        { name: 'customer_id', type: 'INT' },
        { name: 'amount', type: 'DECIMAL(10,2)' },
      ])
    );
    // the table-level `PRIMARY KEY (id)` constraint line should not become a field
    expect(invoices?.fields.some((f) => f.name.toUpperCase() === 'PRIMARY')).toBe(false);
  });
});
