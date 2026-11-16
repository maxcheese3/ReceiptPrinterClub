# print-raw.ps1
# Sends a file of raw ESC/POS bytes to a Windows printer as a RAW spooler job,
# so the printer receives exactly the bytes the client built — the same output
# as macOS and Linux. The printer's driver does no rendering.

param(
  [string]$PrinterName = "",
  [Parameter(Mandatory = $true)][string]$Path
)

$ErrorActionPreference = "Stop"

Add-Type -TypeDefinition @"
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;

public static class RawPrinter {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DOCINFO {
    [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
  }

  [DllImport("winspool.drv", EntryPoint = "OpenPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern bool OpenPrinter(string name, out IntPtr handle, IntPtr defaults);
  [DllImport("winspool.drv", SetLastError = true)]
  static extern bool ClosePrinter(IntPtr handle);
  [DllImport("winspool.drv", EntryPoint = "StartDocPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern int StartDocPrinter(IntPtr handle, int level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFO info);
  [DllImport("winspool.drv", SetLastError = true)]
  static extern bool EndDocPrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)]
  static extern bool StartPagePrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)]
  static extern bool EndPagePrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)]
  static extern bool WritePrinter(IntPtr handle, byte[] bytes, int count, out int written);

  static Win32Exception Fail(string what, string printer) {
    int code = Marshal.GetLastWin32Error();
    return new Win32Exception(code, what + " failed for printer '" + printer + "': " + new Win32Exception(code).Message);
  }

  public static void Send(string printer, byte[] bytes) {
    IntPtr handle;
    if (!OpenPrinter(printer, out handle, IntPtr.Zero)) throw Fail("OpenPrinter", printer);
    try {
      var info = new DOCINFO { pDocName = "PrintBridge receipt", pDataType = "RAW" };
      if (StartDocPrinter(handle, 1, info) == 0) throw Fail("StartDocPrinter", printer);
      try {
        if (!StartPagePrinter(handle)) throw Fail("StartPagePrinter", printer);
        int written;
        bool ok = WritePrinter(handle, bytes, bytes.Length, out written);
        EndPagePrinter(handle);
        if (!ok || written != bytes.Length) throw Fail("WritePrinter", printer);
      } finally {
        EndDocPrinter(handle);
      }
    } finally {
      ClosePrinter(handle);
    }
  }
}
"@

if ($PrinterName -eq "") {
  Add-Type -AssemblyName System.Drawing
  $PrinterName = (New-Object System.Drawing.Printing.PrinterSettings).PrinterName
}

$bytes = [System.IO.File]::ReadAllBytes($Path)
[RawPrinter]::Send($PrinterName, $bytes)
