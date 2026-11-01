class Trace < Formula
  desc "Local Git review with change routes and feedback for coding agents"
  homepage "https://github.com/dmydary-code/trace"
  url "https://github.com/dmydary-code/trace.git",
      tag: "v0.1.3",
      revision: "8f14c91eda7ed918412f8facd4fb68428d5c4a4c"
  version "0.1.3"

  depends_on "node@22"

  def install
    libexec.install "bin", "lib", "dist", "server.mjs", "package.json",
                    "plugins", ".agents", ".claude-plugin"
    (bin/"trace-review").write <<~SH
      #!/bin/sh
      export TRACE_BUNDLE_HOME="#{opt_libexec}"
      exec "#{Formula["node@22"].opt_bin}/node" "#{opt_libexec}/bin/trace.mjs" "$@"
    SH
    ln_s "trace-review", bin/"trace"
  end

  def caveats
    <<~EOS
      Register the bundled agent plugins:
        trace-review install codex
        trace-review install claude
      Restart your agent, then invoke the Trace review skill in a project.
      Claude Code command: /trace:review
      Standalone review: cd /path/to/project && trace-review
    EOS
  end

  test do
    assert_equal version.to_s, shell_output("#{bin}/trace-review --version").strip
    system "git", "init", testpath
    result = JSON.parse(shell_output("#{bin}/trace-review doctor --repo #{testpath} --json"))
    assert_equal testpath.to_s, result.fetch("repository")
  end
end
