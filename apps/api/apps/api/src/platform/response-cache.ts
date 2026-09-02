export interface ResponseLike {
  setHeader(name: string, value: string): void;
}

export function noStore(response: ResponseLike): void {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Pragma', 'no-cache');
}
