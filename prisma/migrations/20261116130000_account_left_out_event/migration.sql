-- Phase 53: an account left out of a jar, or brought back, in the jar history.
ALTER TYPE "JarEventKind" ADD VALUE 'ACCOUNT_LEFT_OUT' AFTER 'ACCOUNTS_SET';
