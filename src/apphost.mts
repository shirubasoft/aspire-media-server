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
    await dashboard.withForwardedHeaders();
    await dashboard.publishAsDockerComposeService(
      async (_dashboard, service) => {
        // The dashboard contains logs, traces, environment metadata, and
        // commands. Keep it on the Compose network instead of host-publishing
        // it. Traefik supplies the deployment authentication boundary, so the
        // dashboard itself must not redirect browsers to an internal token
        // login URL.
        await service.ports.clear();
        await service.environment.set(
          "DOTNET_DASHBOARD_UNSECURED_ALLOW_ANONYMOUS",
          "true",
        );
      },
    );
  });

const parameters = addArrspireParameters(builder);
const paths = resolveArrspirePaths(appHostDirectory);
validateArrspirePaths(paths);

await addArrspireTopology(builder, parameters, paths, isRunMode);

await builder.build().run();
