import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

// Fix dual Uint8Array/TextEncoder prototype mismatch between JSDOM and Node for jose library
if (typeof Uint8Array !== 'undefined') {
  Object.defineProperty(Uint8Array, Symbol.hasInstance, {
    value: (obj: any) =>
      obj !== null &&
      typeof obj === 'object' &&
      (obj.constructor?.name === 'Uint8Array' ||
        Object.prototype.toString.call(obj) === '[object Uint8Array]' ||
        ArrayBuffer.isView(obj)),
  });
}

// Mock window.matchMedia for JSDOM
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock next/cache revalidatePath & revalidateTag for non-Next environment
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn((url: string) => {
    const err = new Error(`NEXT_REDIRECT:${url}`);
    (err as any).digest = `NEXT_REDIRECT;${url}`;
    throw err;
  }),
}));

const cookieStore = new Map<string, string>();

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => {
      const val = cookieStore.get(name);
      return val ? { name, value: val } : undefined;
    },
    set: (name: string, value: string) => {
      cookieStore.set(name, value);
    },
    delete: (name: string) => {
      cookieStore.delete(name);
    },
    has: (name: string) => cookieStore.has(name),
  }),
  headers: async () => new Headers(),
}));

export function resetMockCookies() {
  cookieStore.clear();
}
