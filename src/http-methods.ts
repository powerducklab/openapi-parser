/** OpenAPI 3.2 fixed Path Item fields. Never treat metadata as operations. */
export const OPENAPI_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace', 'query'] as const;
/** Postman presets plus registered HTTP/WebDAV methods. Custom tokens are also accepted. */
export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'TRACE', 'CONNECT', 'QUERY', 'COPY', 'LINK', 'UNLINK', 'PURGE', 'LOCK', 'UNLOCK', 'PROPFIND', 'PROPPATCH', 'MKCOL', 'MOVE', 'REPORT', 'SEARCH', 'ACL', 'BIND', 'UNBIND', 'REBIND', 'CHECKIN', 'CHECKOUT', 'UNCHECKOUT', 'VERSION-CONTROL', 'UPDATE', 'LABEL', 'MERGE', 'BASELINE-CONTROL', 'MKACTIVITY', 'MKCALENDAR', 'MKREDIRECTREF', 'UPDATEREDIRECTREF', 'ORDERPATCH', 'MKWORKSPACE', 'VIEW'] as const;
const fixed = new Set<string>(OPENAPI_METHODS);
export function isHttpMethod(value: unknown): value is string {
  return typeof value === 'string' && /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(value);
}
export function isOpenApiMethod(value: unknown): value is typeof OPENAPI_METHODS[number] {
  return typeof value === 'string' && fixed.has(value.toLowerCase());
}
const object = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
/** Lowercase method names, including additionalOperations, in document order. */
export function operationEntries(pathItem: unknown): Array<[string, any]> {
  if (!object(pathItem)) return [];
  const entries: Array<[string, any]> = [];
  for (const method of OPENAPI_METHODS) if (object(pathItem[method])) entries.push([method, pathItem[method]]);
  if (object(pathItem.additionalOperations)) {
    for (const [method, operation] of Object.entries(pathItem.additionalOperations)) {
      if (isHttpMethod(method) && !fixed.has(method.toLowerCase()) && object(operation)) entries.push([method.toLowerCase(), operation]);
    }
  }
  return entries;
}
export function operationKeys(pathItem: unknown): string[] { return operationEntries(pathItem).map(([method]) => method); }
export function operationPath(method: string, pathItem?: any): string[] {
  if (!isHttpMethod(method)) throw new TypeError(`Invalid HTTP method: ${method}`);
  const lower = method.toLowerCase();
  if (fixed.has(lower)) return [lower];
  const key = object(pathItem?.additionalOperations) ? Object.keys(pathItem.additionalOperations).find(key => key.toLowerCase() === lower) : undefined;
  return ['additionalOperations', key ?? method.toUpperCase()];
}
export function getOperation(pathItem: any, method: string): any {
  if (!isHttpMethod(method)) return undefined;
  return operationPath(method, pathItem).reduce((value, key) => object(value) && Object.prototype.hasOwnProperty.call(value, key) ? value[key] : undefined, pathItem);
}
/** Mutates only the supplied path item; callers own cloning and document version. */
export function setOperation(pathItem: any, method: string, operation: any): void {
  const keys = operationPath(method, pathItem);
  if (keys.length === 1) pathItem[keys[0]] = operation;
  else {
    if (!object(pathItem.additionalOperations)) pathItem.additionalOperations = {};
    Object.defineProperty(pathItem.additionalOperations, keys[1], { value: operation, configurable: true, enumerable: true, writable: true });
  }
}
export function deleteOperation(pathItem: any, method: string): void {
  const keys = operationPath(method, pathItem);
  if (keys.length === 1) delete pathItem[keys[0]];
  else if (object(pathItem?.additionalOperations)) {
    delete pathItem.additionalOperations[keys[1]];
    if (!Object.keys(pathItem.additionalOperations).length) delete pathItem.additionalOperations;
  }
}
