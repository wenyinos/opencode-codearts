import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import {
  credentialStatus,
  credentialsFromEnv,
  maskSecret,
  profileFiles,
  readProfileAssignment,
  resolveCredentials,
  shellName,
} from "./credentials.js"

describe("credentials", () => {
  it("reads both environment variables", () => {
    expect(
      credentialsFromEnv({ CODEARTS_CLI_AK: "AKID", CODEARTS_CLI_SK: "SECRET" }),
    ).toEqual({ ak: "AKID", sk: "SECRET" })
  })

  it("treats a lone AK as not configured", () => {
    expect(credentialsFromEnv({ CODEARTS_CLI_AK: "AKID" })).toBeNull()
    expect(credentialsFromEnv({ CODEARTS_CLI_SK: "SECRET" })).toBeNull()
    expect(
      credentialStatus({ CODEARTS_CLI_AK: "AKID" }),
    ).toMatchObject({ configured: false, missing: ["CODEARTS_CLI_SK"] })
  })

  it("supports an optional security token", () => {
    expect(
      credentialsFromEnv({
        CODEARTS_CLI_AK: "AKID",
        CODEARTS_CLI_SK: "SECRET",
        CODEARTS_CLI_SECURITY_TOKEN: "ST",
      }),
    ).toEqual({ ak: "AKID", sk: "SECRET", securityToken: "ST" })
  })

  it("masks secrets for logs", () => {
    expect(maskSecret("AKIDEXAMPLE")).toBe("AKID****LE")
    expect(maskSecret("short")).toBe("s****")
    expect(maskSecret("")).toBe("")
  })

  it("orders profile files for the current shell, then the common fallbacks", () => {
    expect(shellName({ SHELL: "/bin/bash" })).toBe("bash")
    expect(profileFiles({ SHELL: "/usr/bin/zsh", HOME: "/home/x" })[0]).toBe("/home/x/.zshenv")
    expect(profileFiles({ SHELL: "/bin/bash", HOME: "/home/x" })[0]).toBe(
      "/home/x/.bash_profile",
    )
    expect(profileFiles({ SHELL: "/usr/bin/fish", HOME: "/home/x" })[0]).toBe(
      "/home/x/.config/fish/config.fish",
    )
    expect(profileFiles({ SHELL: "/bin/sh", HOME: "/home/x" })[0]).toBe("/home/x/.profile")
  })

  it("extracts an assignment from a shell profile", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codearts-profile-"))
    const file = path.join(dir, ".zshrc")
    fs.writeFileSync(
      file,
      [
        "# credentials for CodeArts",
        'export CODEARTS_CLI_AK="PROFILE_AK"',
        "CODEARTS_CLI_SK=PROFILE_SK # the secret",
      ].join("\n"),
    )
    expect(readProfileAssignment(file, "CODEARTS_CLI_AK")).toBe("PROFILE_AK")
    expect(readProfileAssignment(file, "CODEARTS_CLI_SK")).toBe("PROFILE_SK")
    expect(readProfileAssignment(file, "MISSING_KEY")).toBe("")
  })

  it("reads fish's set -gx syntax", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codearts-fish-"))
    const file = path.join(dir, "config.fish")
    fs.writeFileSync(
      file,
      "set -gx CODEARTS_CLI_AK FISH_AK\nset --export CODEARTS_CLI_SK 'FISH_SK'\n",
    )
    expect(readProfileAssignment(file, "CODEARTS_CLI_AK")).toBe("FISH_AK")
    expect(readProfileAssignment(file, "CODEARTS_CLI_SK")).toBe("FISH_SK")
  })

  it("falls back to the shell profile when the environment lacks the pair", () => {
    const previous = process.env.CODEARTS_DISABLE_PROFILE
    delete process.env.CODEARTS_DISABLE_PROFILE
    try {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codearts-profile-"))
      const file = path.join(dir, ".zshrc")
      fs.writeFileSync(
        file,
        "export CODEARTS_CLI_AK='PROFILE_AK'\nexport CODEARTS_CLI_SK=PROFILE_SK\n",
      )
      const resolved = resolveCredentials({ HOME: dir })
      expect(resolved.credentials).toEqual({ ak: "PROFILE_AK", sk: "PROFILE_SK" })
      expect(resolved.source).toBe("profile")
      expect(resolved.sourceFile).toBe(file)

      // The environment always wins over the profile.
      const fromEnv = resolveCredentials({
        HOME: dir,
        CODEARTS_CLI_AK: "ENV_AK",
        CODEARTS_CLI_SK: "ENV_SK",
      })
      expect(fromEnv.credentials).toEqual({ ak: "ENV_AK", sk: "ENV_SK" })
      expect(fromEnv.source).toBe("env")
    } finally {
      if (previous === undefined) delete process.env.CODEARTS_DISABLE_PROFILE
      else process.env.CODEARTS_DISABLE_PROFILE = previous
    }
  })
})
