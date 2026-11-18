import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Desmonta o que o @testing-library/react renderizou entre os testes.
afterEach(() => {
  cleanup();
});
