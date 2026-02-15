import { helperB } from './b';
import { z } from 'zod';

const schema = z.string();

export function helperA(): string {
  return `${helperB()}:${schema.safeParse('ok').success}`;
}
