import { expect, it } from 'vitest';
import { operationEntries, getOperation, setOperation, deleteOperation, operationPath, isHttpMethod, HTTP_METHODS } from '../src/http-methods';
it('round trips fixed, QUERY and custom methods without consuming path metadata', () => {
 const item: any = { parameters: [], summary: 'metadata' };
 for (const method of [...HTTP_METHODS, 'CUSTOM-VERB']) setOperation(item, method, { operationId: method });
 expect(operationEntries(item)).toHaveLength(HTTP_METHODS.length + 1);
 expect(item.query.operationId).toBe('QUERY');
 expect(item.additionalOperations.PROPFIND.operationId).toBe('PROPFIND');
 expect(getOperation(item, 'propfind').operationId).toBe('PROPFIND');
 expect(operationPath('propfind', item)).toEqual(['additionalOperations', 'PROPFIND']);
 deleteOperation(item, 'propfind'); expect(getOperation(item, 'PROPFIND')).toBeUndefined();
 expect(isHttpMethod('GET\r\nHeader: bad')).toBe(false);
 expect(() => setOperation(item, 'bad method', {})).toThrow();
});
it('supports existing custom key casing and safe object keys', () => {
 expect(getOperation({additionalOperations:{}}, '__proto__')).toBeUndefined();
 expect(getOperation({additionalOperations:{}}, 'constructor')).toBeUndefined();
 const item: any = { additionalOperations: { Report: { responses: {} } } };
 setOperation(item, 'report', { operationId: 'new' });
 expect(Object.keys(item.additionalOperations)).toEqual(['Report']);
 setOperation(item, '__proto__', { operationId: 'safe' });
 expect(getOperation(item, '__proto__').operationId).toBe('safe');
 expect(Object.getPrototypeOf(item.additionalOperations)).toBe(Object.prototype);
});
