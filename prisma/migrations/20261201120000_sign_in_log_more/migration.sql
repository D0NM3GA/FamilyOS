-- Phase 67a: more of how people get in goes in the sign-in log.
ALTER TYPE "SignInEventKind" ADD VALUE 'SIGNED_OUT_ELSEWHERE';
ALTER TYPE "SignInEventKind" ADD VALUE 'SIGNED_OUT_EVERYWHERE';
ALTER TYPE "SignInEventKind" ADD VALUE 'PIN_SET';
ALTER TYPE "SignInEventKind" ADD VALUE 'PIN_LOCKED';
ALTER TYPE "SignInEventKind" ADD VALUE 'MEMBER_REMOVED';
