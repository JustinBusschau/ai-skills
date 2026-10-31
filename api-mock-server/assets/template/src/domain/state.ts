// The session's data. Keep it plain JSON (records and arrays, no Maps, Dates or class
// instances) so /__mock/state can show it and the tests can compare it with the seed.
// Replace this with the API's resources. See assets/example-acme-wallet/domain/state.ts.
export interface State {
  seq: number;
}
