import { json, request } from "./http.js";
import { log } from "./log.js";

const backupName = "Arrspire Configuration";

interface DuplicatiAuthentication {
  readonly AccessToken?: string;
}

interface DuplicatiBackupSummary {
  readonly Backup?: {
    readonly ID?: string;
    readonly Name?: string;
  };
}

interface DuplicatiBackupDefinition {
  readonly Backup: Readonly<Record<string, unknown>>;
  readonly Schedule: Readonly<Record<string, unknown>>;
}

export function duplicatiBackupDefinition(
  encryptionKey: string,
): DuplicatiBackupDefinition {
  return {
    Backup: {
      Name: backupName,
      Description:
        "Encrypted backup of Arrspire service configuration volumes",
      Tags: [],
      TargetURL: "file:///backups/arrspire-config",
      Sources: ["/source"],
      Settings: [
        {
          Filter: "",
          Name: "encryption-module",
          Value: "aes",
          Argument: null,
        },
        {
          Filter: "",
          Name: "passphrase",
          Value: encryptionKey,
          Argument: null,
        },
      ],
      Filters: [],
      Metadata: {},
      IsTemporary: false,
      AdditionalTargetURLs: [],
    },
    Schedule: {
      Tags: [],
      Time: "2020-01-01T13:00:00Z",
      Repeat: "1D",
      Rule:
        "AllowedWeekDays=Monday,Tuesday,Wednesday,Thursday,Friday,Saturday,Sunday",
      AllowedDays: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
    },
  };
}

export class DuplicatiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly webPassword: string,
    private readonly encryptionKey: string,
  ) {}

  async reconcile(): Promise<void> {
    const authentication = await json<DuplicatiAuthentication>(
      `${this.baseUrl}/api/v1/auth/login`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ Password: this.webPassword }),
      },
    );
    if (!authentication.AccessToken) {
      throw new Error("Duplicati did not return an access token");
    }
    const headers = {
      Authorization: `Bearer ${authentication.AccessToken}`,
      "Content-Type": "application/json",
    };
    const backups = await json<readonly DuplicatiBackupSummary[]>(
      `${this.baseUrl}/api/v1/backups`,
      { headers },
    );
    if (backups.some((backup) => backup.Backup?.Name === backupName)) {
      log.info("Duplicati backup already configured", { backup: backupName });
      return;
    }

    await request(`${this.baseUrl}/api/v1/backups`, {
      method: "POST",
      headers,
      body: JSON.stringify(duplicatiBackupDefinition(this.encryptionKey)),
    });
    log.info("Duplicati encrypted backup configured", { backup: backupName });
  }
}
