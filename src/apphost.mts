import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createBuilder } from "./.aspire/modules/aspire.mjs";
import { aspireDashboardDigest } from "./apphost/images.mjs";
import { addArrspireParameters } from "./apphost/parameters.mjs";
import { validateArrspirePaths } from "./apphost/path-validation.mjs";
import { resolveArrspirePaths } from "./apphost/paths.mjs";
import { addArrspireTopology } from "./apphost/topology.mjs";

const builder = await createBuilder();
const executionContext = builder.executionContext();
const isRunMode = await executionContext.isRunMode();
const appHostDirectory = dirname(fileURLToPath(import.meta.url));

await builder
  .addDockerComposeEnvironment("arrspire")
  .configureDashboard(async (dashboard) => {
    await dashboard.withImageSHA256(
      aspireDashboardDigest.slice("sha256:".length),
    );
    await dashboard.publishAsDockerComposeService(
      async (_dashboard, service) => {
        // The dashboard contains logs, traces, environment metadata, and
        // commands. Keep it on the Compose network instead of host-publishing
        // it; local run mode still exposes its authenticated developer URL.
        await service.ports.clear();
      },
    );
  });

const parameters = addArrspireParameters(builder);
const paths = resolveArrspirePaths(appHostDirectory, isRunMode);
validateArrspirePaths(paths);

await addArrspireTopology(builder, parameters, paths, isRunMode);

await builder.build().run();
