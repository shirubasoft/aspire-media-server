import { json, request } from "./http.js";

const mediaLibraryId = "arrspire-media";

interface TdarrLibrary {
  readonly _id?: string;
  readonly name?: string;
  readonly folder?: string;
}

interface TdarrNode {
  readonly nodeName?: string;
  readonly workerLimits?: Readonly<Record<string, number>>;
}

function schedule(): readonly Readonly<{
  _id: string;
  checked: boolean;
}>[] {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thur", "Fri", "Sat"];
  return days.flatMap((day) =>
    Array.from({ length: 24 }, (_, hour) => ({
      _id: `${day}:${String(hour).padStart(2, "0")}-${String(
        (hour + 1) % 24,
      ).padStart(2, "0")}`,
      checked: true,
    })),
  );
}

export function tdarrMediaLibrary(): Readonly<Record<string, unknown>> {
  return {
    _id: mediaLibraryId,
    priority: 0,
    name: "Arrspire Media",
    folder: "/media",
    foldersToIgnore: "",
    foldersToIgnoreCaseInsensitive: false,
    folderWatchScanInterval: 30,
    scannerThreadCount: 2,
    cache: "/temp",
    output: "",
    folderToFolderConversion: false,
    folderToFolderConversionDeleteSource: false,
    folderToFolderRecordHistory: true,
    copyIfConditionsMet: false,
    container: ".mkv",
    containerFilter:
      "mkv,mp4,mov,m4v,mpg,mpeg,avi,flv,webm,wmv,vob,evo,iso,m2ts,ts,mp3,m4a,flac,ogg,opus,wav",
    createdAt: 1_675_837_380_368,
    folderWatching: true,
    useFsEvents: true,
    scheduledScanFindNew: true,
    processLibrary: true,
    // A default deployment should verify media health without unexpectedly
    // rewriting a user's files. Transcoding can be enabled in the UI after a
    // deliberate codec/quality policy is selected.
    processTranscodes: false,
    processHealthChecks: true,
    scanOnStart: true,
    exifToolScan: true,
    mediaInfoScan: true,
    ffprobeShowData: false,
    isDirectoryLibrary: false,
    closedCaptionScan: false,
    scanButtons: true,
    scanFound: "",
    navItemSelected: "navSourceFolder",
    pluginIDs: [],
    pluginCommunity: true,
    handbrake: true,
    ffmpeg: false,
    handbrakescan: true,
    ffmpegscan: false,
    preset: '-Z "Very Fast 1080p30"',
    decisionMaker: {
      settingsPlugin: false,
      settingsFlows: false,
      settingsVideo: false,
      settingsAudio: false,
    },
    schedule: schedule(),
    totalHealthCheckCount: 0,
    totalTranscodeCount: 0,
    sizeDiff: 0,
    holdNewFiles: false,
    holdFor: 3600,
    holdForDisplayUnit: "hours",
    pluginStackOverview: true,
    filterResolutionsSkip: "",
    filterCodecsSkip: "",
    filterContainersSkip: "",
    filterHardlinked: false,
    processPluginsSequentially: true,
  };
}

function crudBody(
  mode: "getAll" | "insert" | "update" | "removeOne",
  options: {
    readonly docID?: string;
    readonly obj?: Readonly<Record<string, unknown>>;
  } = {},
): string {
  return JSON.stringify({
    data: {
      collection: "LibrarySettingsJSONDB",
      mode,
      ...(options.docID === undefined ? {} : { docID: options.docID }),
      ...(options.obj === undefined ? {} : { obj: options.obj }),
    },
  });
}

export class TdarrClient {
  constructor(private readonly baseUrl: string) {}

  async reconcile(): Promise<void> {
    const libraries = await json<readonly TdarrLibrary[]>(
      `${this.baseUrl}/api/v2/cruddb`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: crudBody("getAll"),
      },
    );
    const desired = tdarrMediaLibrary();
    const existing = libraries.find((library) => library._id === mediaLibraryId);
    await request(`${this.baseUrl}/api/v2/cruddb`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: crudBody(existing === undefined ? "insert" : "update", {
        docID: mediaLibraryId,
        obj: desired,
      }),
    });

    for (const library of libraries) {
      if (
        library._id !== undefined &&
        library._id !== mediaLibraryId &&
        library.name === "Library Name" &&
        (library.folder ?? "") === ""
      ) {
        await request(`${this.baseUrl}/api/v2/cruddb`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: crudBody("removeOne", { docID: library._id }),
        });
      }
    }

    const nodes = await json<Readonly<Record<string, TdarrNode>>>(
      `${this.baseUrl}/api/v2/get-nodes`,
    );
    const internalNode = Object.entries(nodes).find(
      ([, node]) => node.nodeName === "InternalNode",
    );
    if (internalNode === undefined) {
      throw new Error("Tdarr InternalNode is not connected");
    }
    const [nodeId, node] = internalNode;
    const healthWorkers = node.workerLimits?.healthcheckcpu ?? 0;
    for (let worker = healthWorkers; worker < 1; worker += 1) {
      await request(`${this.baseUrl}/api/v2/alter-worker-limit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          data: {
            nodeID: nodeId,
            process: "increase",
            workerType: "healthcheckcpu",
          },
        }),
      });
    }

    await request(`${this.baseUrl}/api/v2/scan-files`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        data: {
          scanConfig: {
            dbID: mediaLibraryId,
            mode: "scanFindNew",
            arrayOrPath: "/media",
          },
        },
      }),
    });
  }
}
