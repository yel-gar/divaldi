// This file is rewritten at build time by docker/rewrite-env.mjs,
// which substitutes the BACKEND_URL build arg (falls back to same-origin /api/v1).
export const environment = {
  production: true,
  apiUrl: '__BACKEND_URL__/api/v1'
};
