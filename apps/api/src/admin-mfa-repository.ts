import type { EncryptedSecret } from "./secret-cipher.js";
export type MfaCredential = EncryptedSecret & {
  enabled: boolean;
  lastCounter: number;
};
export interface AdminMfaRepository {
  credential(userId: string): Promise<MfaCredential | null>;
  sessionStatus(
    userId: string,
    sessionHash: string,
  ): Promise<{ enabled: boolean; verifiedAt: string | null }>;
  saveEnrollment(
    userId: string,
    secret: EncryptedSecret,
    now: string,
  ): Promise<void>;
  confirm(input: {
    userId: string;
    sessionHash: string;
    counter: number;
    recoveryHashes: string[];
    now: string;
  }): Promise<void>;
  verifyCounter(
    userId: string,
    sessionHash: string,
    counter: number,
    now: string,
  ): Promise<void>;
  consumeRecovery(
    userId: string,
    sessionHash: string,
    hash: string,
    now: string,
  ): Promise<boolean>;
}
