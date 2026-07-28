import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createBuilder } from "./.aspire/modules/aspire.mjs";
import { addArrspireParameters } from "./apphost/parameters.mjs";
import { resolveArrspirePaths } from "./apphost/paths.mjs";
import { addArrspireTopology } from "./apphost/topology.mjs";

const builder = await createBuilder();
const executionContext = builder.executionContext();
const isRunMode = await executionContext.isRunMode();
const appHostDirectory = dirname(fileURLToPath(import.meta.url));

await builder.addDockerComposeEnvironment("arrspire");

const parameters = addArrspireParameters(builder);
const paths = resolveArrspirePaths(appHostDirectory, isRunMode);

await addArrspireTopology(builder, parameters, paths, isRunMode);

await builder.build().run();
