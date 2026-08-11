import { createAuthController } from './auth-controller.js';

export {
  AUTH_MODES,
  SAFE_RESET_MESSAGE,
  authErrorMessage,
  validateAuthFields,
  createAuthController,
} from './auth-controller.js';

// Kept as a compatibility export for older deterministic consumers.
export function createLandingAuthController({ navigateToApp, onAuthenticated, ...dependencies }) {
  return createAuthController({
    ...dependencies,
    onAuthenticated: onAuthenticated || navigateToApp,
  });
}
