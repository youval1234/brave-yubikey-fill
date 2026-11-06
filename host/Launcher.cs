using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading.Tasks;

internal static class Launcher
{
    private static readonly string Root = AppDomain.CurrentDomain.BaseDirectory;

    private static void Main(string[] args)
    {
        try
        {
            // Brave also checks allowed_origins before launching the host.
            if (args.Length == 0 || args[0] != File.ReadAllText(Path.Combine(Root, "origin.txt")))
                return;

            byte[] request = ReadFrame(Console.OpenStandardInput(), 4096);
            byte[] reply = RunHelper(request);
            using (Stream output = Console.OpenStandardOutput())
                output.Write(reply, 0, reply.Length);
        }
        catch (Exception)
        {
            // Keep exception details and credential data out of browser logs.
        }
    }

    private static byte[] RunHelper(byte[] request)
    {
        string script = Path.Combine(Root, "yubikey_fill_host.py");
        var start = new ProcessStartInfo
        {
            FileName = Path.Combine(Root, "venv", "Scripts", "python.exe"),
            Arguments = "-I -B \"" + script + "\"",
            WorkingDirectory = Root,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true
        };

        using (Process child = Process.Start(start))
        {
            // Drain diagnostics without retaining or forwarding them.
            child.ErrorDataReceived += (sender, eventArgs) => {};
            child.BeginErrorReadLine();
            Task<byte[]> response = Task.Run(() => ReadFrame(child.StandardOutput.BaseStream, 65536));
            using (Stream input = child.StandardInput.BaseStream)
                input.Write(request, 0, request.Length);

            if (!child.WaitForExit(55000))
            {
                try { child.Kill(); }
                catch (InvalidOperationException) { } // Exited between the wait and kill.
                byte[] body = Encoding.ASCII.GetBytes("{\"ok\":false,\"error\":\"timeout\"}");
                return Combine(BitConverter.GetBytes(body.Length), body);
            }
            if (child.ExitCode != 0 || !response.Wait(1000))
                throw new InvalidDataException();
            return response.Result;
        }
    }

    private static byte[] ReadFrame(Stream stream, int limit)
    {
        byte[] header = ReadBytes(stream, 4);
        int length = BitConverter.ToInt32(header, 0);
        if (length <= 0 || length > limit)
            throw new InvalidDataException();
        return Combine(header, ReadBytes(stream, length));
    }

    private static byte[] ReadBytes(Stream stream, int length)
    {
        var bytes = new byte[length];
        int offset = 0;
        while (offset < length)
        {
            int count = stream.Read(bytes, offset, length - offset);
            if (count == 0)
                throw new EndOfStreamException();
            offset += count;
        }
        return bytes;
    }

    private static byte[] Combine(byte[] header, byte[] body)
    {
        var frame = new byte[header.Length + body.Length];
        Buffer.BlockCopy(header, 0, frame, 0, header.Length);
        Buffer.BlockCopy(body, 0, frame, header.Length, body.Length);
        return frame;
    }
}
