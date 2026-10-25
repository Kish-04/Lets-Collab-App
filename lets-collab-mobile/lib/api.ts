export const BACKEND_URL = 'https://let-s-collab-tjwc.onrender.com';

import { Platform } from 'react-native'
import * as SecureStore from 'expo-secure-store'

export async function getStoredAuthToken() {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('ircp_token');
    }
  } else {
    return await SecureStore.getItemAsync('ircp_token');
  }
  return null;
}

export async function getAuthHeaders() {
  const token = await getStoredAuthToken();

  return {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {})
  };
}

export async function storeAuthToken(token: string) {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined') {
      localStorage.setItem('ircp_token', token);
    }
  } else {
    await SecureStore.setItemAsync('ircp_token', token);
  }
}

export async function removeAuthToken() {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('ircp_token');
      localStorage.removeItem('ircp_email');
      localStorage.removeItem('ircp_role');
    }
  } else {
    await SecureStore.deleteItemAsync('ircp_token');
    await SecureStore.deleteItemAsync('ircp_email');
    await SecureStore.deleteItemAsync('ircp_role');
  }
}

/** The signed-in account's role ('admin' or 'user'), stored at login; decides which tabs are shown. */
export async function storeRole(role: string) {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined') localStorage.setItem('ircp_role', role);
  } else {
    await SecureStore.setItemAsync('ircp_role', role);
  }
}

export async function getStoredRole(): Promise<string | null> {
  if (Platform.OS === 'web') {
    return typeof window !== 'undefined' ? localStorage.getItem('ircp_role') : null;
  }
  return await SecureStore.getItemAsync('ircp_role');
}

export async function getStoredEmail() {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('ircp_email');
    }
  } else {
    return await SecureStore.getItemAsync('ircp_email');
  }
  return null;
}

export async function storeEmail(email: string) {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined') {
      localStorage.setItem('ircp_email', email);
    }
  } else {
    await SecureStore.setItemAsync('ircp_email', email);
  }
}
