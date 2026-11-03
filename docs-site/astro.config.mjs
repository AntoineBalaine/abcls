import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

export default defineConfig({
  site: "https://antoinebalaine.github.io",
  base: "/abcls",
  // Workaround for zod v3/v4 conflict in the Astro SSR build.
  // See https://github.com/withastro/astro/issues/14117
  vite: {
    ssr: {
      noExternal: ["zod"],
    },
  },
  integrations: [
    starlight({
      title: "abcls",
      customCss: ["./src/styles/custom.css"],
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/AntoineBalaine/abcls",
        },
        {
          icon: "npm",
          label: "npm",
          href: "https://www.npmjs.com/package/abcls",
        },
        {
          icon: "vscode",
          label: "VS Code Marketplace",
          href: "https://marketplace.visualstudio.com/items?itemName=AntoineBalaine.abc-ls",
        },
      ],
      sidebar: [
        { label: "Getting Started", link: "/" },
        { label: "ABC Notation Basics", slug: "abc-notation-basics" },
        {
          label: "User Guide",
          items: [
            { label: "abcls Directives", slug: "user-guide/abcls-directives" },
            { label: "Selectors", slug: "user-guide/selectors" },
            { label: "Transforms", slug: "user-guide/transforms" },
            {
              label: "Preview and Playback",
              slug: "user-guide/preview-and-playback",
            },
            { label: "ABCx Chord Sheets", slug: "user-guide/abcx-chord-sheets" },
            { label: "iReal Pro Export", slug: "user-guide/ireal-export" },
            { label: "MusicXML", slug: "user-guide/musicxml" },
            { label: "Kakoune Integration", slug: "user-guide/kakoune" },
          ],
        },
        { label: "Directives Reference", slug: "directives-reference" },
        { label: "CLI Reference", slug: "cli-reference" },
        { label: "Architecture", slug: "architecture" },
        { label: "Gallery", slug: "gallery" },
      ],
    }),
  ],
});
