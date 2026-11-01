class Trace < Formula
  desc "Local Git review with change routes and feedback for coding agents"
  homepage "https://github.com/dmydary-code/trace"
  url "https://github.com/dmydary-code/trace.git",
      tag: "v0.1.0",
      revision: "6967f62b2c4d70a640b684bd8b5a52cdef486104"
  version "0.1.0"

  depends_on "node@22"

  def install
    libexec.install "bin", "lib", "dist", "server.mjs", "package.json",
                    "plugins", ".agents", ".claude-plugin"
    (bin/"trace").write <<~SH
      #!/bin/sh
      export TRACE_BUNDLE_HOME="#{opt_libexec}"
      exec "#{Formula["node@22"].opt_bin}/node" "#{opt_libexec}/bin/trace.mjs" "$@"
    SH
  end

  def caveats
    <<~EOS
      Register the bundled agent plugins:
        trace install codex
        trace install claude
      Restart your agent, then invoke the Trace review skill in a project.
      Claude Code command: /trace:review
      Standalone review: cd /path/to/project && trace
    EOS
  end

  test do
    assert_equal version.to_s, shell_output("#{bin}/trace --version").strip
    system "git", "init", testpath
    result = JSON.parse(shell_output("#{bin}/trace doctor --repo #{testpath} --json"))
    assert_equal testpath.to_s, result.fetch("repository")
  end
end
