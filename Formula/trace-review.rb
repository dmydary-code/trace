class TraceReview < Formula
  desc "Local Git review with dependency graphs and feedback for coding agents"
  homepage "https://github.com/dmydary-code/trace"
  license "MIT"
  url "https://github.com/dmydary-code/trace.git",
      tag: "v0.4.1",
      revision: "cdae853322e3fa215631d46b5d37d2d42834abda"
  version "0.4.1"

  depends_on "node@22"
  depends_on "git"

  def install
    libexec.install "bin", "lib", "dist", "server.mjs", "package.json",
                    "plugins", ".agents", ".claude-plugin"
    (bin/"trace-review").write <<~SH
      #!/bin/sh
      export TRACE_BUNDLE_HOME="#{opt_libexec}"
      export TRACE_GIT_BIN="#{Formula["git"].opt_bin}/git"
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
