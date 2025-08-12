// src/api.js

// fragments microservice API to use, defaults to localhost:8080 if not set in env
export const apiUrl = process.env.API_URL || 'http://localhost:8080';


/**
 * Given an authenticated user, request all fragments for this user from the
 * fragments microservice (currently only running locally). We expect a user
 * to have an `idToken` attached, so we can send that along with the request.
 */
export async function getUserFragments(user, expand = false) {
  console.log('Requesting user fragments data...');
  try {
    const url = `${apiUrl}/v1/fragments${expand ? '?expand=1' : ''}`;
    const res = await fetch(url, {
      headers: user.authorizationHeaders(),
    });
    if (!res.ok) {
      throw new Error(`${res.status} ${res.statusText}`);
    }
    const data = await res.json();
    console.log('Successfully got user fragments data', { data });
    return data;
  } catch (err) {
    console.error('Unable to call GET /v1/fragments', { err });
    return { fragments: [] };
  }
}

