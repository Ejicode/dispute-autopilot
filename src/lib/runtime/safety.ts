import { merchantScope } from '../auth/context';
import { HttpError } from '../auth/session';
import { provenanceFor } from './mode';

export function requireDemo(): void {
  if (merchantScope().mode !== 'demo') throw new HttpError(403, 'This simulation is available only in demo mode.');
}
export function requireMatchingProvenance(record: { provenance?: string }): void {
  if (record.provenance !== provenanceFor(merchantScope().mode)) {
    throw new HttpError(422, 'Record provenance does not match this environment.');
  }
}
