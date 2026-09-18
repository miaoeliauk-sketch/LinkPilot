import { copyFile, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";

const OUTPUT = "dist-app";

/** tsc 只搬 .ts，界面资源和配置 JSON 得自己复制过去，否则打包出来的应用是空壳 */
async function copyInto(targetDirectory: string, files: Array<[string, string]>) {
  await mkdir(targetDirectory, { recursive: true });
  await Promise.all(
    files.map(([source, name]) => copyFile(source, join(targetDirectory, name))),
  );
}

async function main() {
  await copyInto(join(OUTPUT, "app"), [["app/preload.cjs", "preload.cjs"]]);

  await copyInto(join(OUTPUT, "app", "renderer"), [
    ["app/renderer/index.html", "index.html"],
    ["app/renderer/styles.css", "styles.css"],
  ]);

  const configDirectory = join("src", "voice", "config");
  const configFiles = (await readdir(configDirectory)).filter((name) =>
    name.endsWith(".json"),
  );
  await copyInto(
    join(OUTPUT, configDirectory),
    configFiles.map((name) => [join(configDirectory, name), name]),
  );

  process.stdout.write(
    `已复制界面资源和 ${configFiles.length} 个配置文件到 ${OUTPUT}\n`,
  );
}

await main();
