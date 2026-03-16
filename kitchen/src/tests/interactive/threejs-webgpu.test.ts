import { defineTest } from "../../test-framework/types";
import { BrowserView, BrowserWindow } from "electrobun/bun";

export const threejsWebgpuTests = [
  defineTest({
    name: "Three.js WebGPU playground",
    category: "Three.js WebGPU (Interactive)",
    description: "Test Three.js WebGPU rendering with TSL node materials",
    interactive: true,
    timeout: 600000,
    async run({ log, showInstructions }) {
      await showInstructions([
        "A Three.js WebGPU scene will open with a rotating torus knot and orbiting spheres",
        "Verify the scene renders correctly with animated colors (TSL node materials)",
        "Close the window when done to pass the test",
      ]);

      log("Opening Three.js WebGPU playground window");

      await new Promise<void>((resolve) => {
        let winRef: BrowserWindow<any> | null = null;

        const rpc = BrowserView.defineRPC<any>({
          maxRequestTime: 600000,
          handlers: {
            requests: {
              closeWindow: () => {
                winRef?.close();
                return { success: true };
              },
            },
            messages: {},
          },
        });

        winRef = new BrowserWindow({
          title: "Three.js WebGPU Playground",
          url: "views://playgrounds/threejs-webgpu/index.html",
          renderer: "cef",
          frame: { width: 900, height: 700, x: 100, y: 60 },
          rpc,
        });

        winRef.setAlwaysOnTop(true);
        const win = winRef;

        win.on("close", () => {
          log("Playground closed - test complete");
          resolve();
        });
      });
    },
  }),
];
