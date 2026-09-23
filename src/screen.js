// Capture de zones de la fenetre Minecraft, via un processus PowerShell
// persistant (GDI, ~40 ms par capture en 4K). Rien n'est enregistre sur disque.
import { spawn } from 'node:child_process';
import readline from 'node:readline';

const HELPER = String.raw`
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System; using System.Diagnostics; using System.Drawing; using System.Drawing.Imaging;
using System.Runtime.InteropServices;
public static class Mbp {
  [StructLayout(LayoutKind.Sequential)] struct RECT { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential)] struct POINT { public int X, Y; }
  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr v);
  [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr h, ref POINT p);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  // Coordonnees en pixels physiques, independamment de la mise a l'echelle Windows.
  public static void Init() { SetProcessDpiAwarenessContext(new IntPtr(-4)); }
  public static string Window() {
    var ps = Process.GetProcessesByName("Minecraft.Windows");
    if (ps.Length == 0 || ps[0].MainWindowHandle == IntPtr.Zero) return "{\"found\":false}";
    var h = ps[0].MainWindowHandle; RECT r; GetClientRect(h, out r); var p = new POINT(); ClientToScreen(h, ref p);
    return "{\"found\":true,\"fg\":" + (GetForegroundWindow() == h ? "true" : "false")
      + ",\"minimized\":" + (IsIconic(h) ? "true" : "false")
      + ",\"x\":" + p.X + ",\"y\":" + p.Y + ",\"w\":" + r.R + ",\"h\":" + r.B + "}";
  }
  // Pixels bruts BGRA, lignes contigues (stride = 4 * largeur en 32 bits).
  public static string Grab(int x, int y, int w, int h) {
    using (var bmp = new Bitmap(w, h, PixelFormat.Format32bppArgb)) {
      using (var g = Graphics.FromImage(bmp)) g.CopyFromScreen(x, y, 0, 0, new Size(w, h));
      var d = bmp.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
      var buf = new byte[d.Stride * h]; Marshal.Copy(d.Scan0, buf, 0, buf.Length); bmp.UnlockBits(d);
      return Convert.ToBase64String(buf);
    }
  }
}
'@
[Mbp]::Init()
[Console]::Out.WriteLine('ready'); [Console]::Out.Flush()
while ($true) {
  $line = [Console]::In.ReadLine(); if ($null -eq $line) { break }
  $a = $line.Split(' ')
  try {
    if ($a[0] -eq 'window') { $r = [Mbp]::Window() }
    elseif ($a[0] -eq 'grab') { $r = [Mbp]::Grab([int]$a[1], [int]$a[2], [int]$a[3], [int]$a[4]) }
    else { $r = 'ERR commande inconnue' }
  } catch { $r = 'ERR ' + ($_.Exception.Message -replace '\s+', ' ') }
  [Console]::Out.WriteLine($r); [Console]::Out.Flush()
}
`;

export class ScreenReader {
  #proc = null;
  #ready = null;
  #waiting = [];

  start() {
    const encoded = Buffer.from(HELPER, 'utf16le').toString('base64');
    this.#proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    let signalReady;
    this.#ready = new Promise((resolve) => { signalReady = resolve; });
    readline.createInterface({ input: this.#proc.stdout }).on('line', (line) => {
      if (line === 'ready') signalReady(true);
      else this.#waiting.shift()?.(line);
    });
    this.#proc.on('exit', () => {
      signalReady(false);
      for (const resolve of this.#waiting.splice(0)) resolve('ERR processus de capture arrete');
      this.#proc = null;
    });
    return this;
  }

  get alive() {
    return this.#proc !== null;
  }

  async #ask(command) {
    if (!(await this.#ready) || !this.#proc) throw new Error('capture indisponible');
    const line = await new Promise((resolve) => {
      this.#waiting.push(resolve);
      this.#proc.stdin.write(`${command}\n`);
    });
    if (line.startsWith('ERR')) throw new Error(line.slice(4));
    return line;
  }

  /** { found, fg, minimized, x, y, w, h } : zone client de la fenetre, en pixels ecran. */
  async window() {
    return JSON.parse(await this.#ask('window'));
  }

  /** Capture une zone de l'ecran : { w, h, data } avec data en BGRA. */
  async grab(x, y, w, h) {
    const data = Buffer.from(await this.#ask(`grab ${x} ${y} ${w} ${h}`), 'base64');
    return { w, h, data };
  }

  stop() {
    this.#proc?.kill();
    this.#proc = null;
  }
}
