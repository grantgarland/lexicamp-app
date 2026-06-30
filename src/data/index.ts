// The active data source. Swap to a SupabaseDataSource here when the backend
// lands — nothing else changes (query hooks depend only on the DataSource interface).
import type { DataSource } from './DataSource';
import { mockDataSource } from './mock';

export const dataSource: DataSource = mockDataSource;
export type { DataSource, DeckCards, Engagement } from './DataSource';
