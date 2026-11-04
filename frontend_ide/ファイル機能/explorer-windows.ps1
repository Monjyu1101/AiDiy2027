# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
$ErrorActionPreference = 'Stop'
$source = $env:AIDIY_EXPLORER_SOURCE
if ($env:AIDIY_EXPLORER_ACTION -eq 'rename') {
    # .NET の2引数 Move は既存の項目を上書きしない。
    if ($env:AIDIY_EXPLORER_TYPE -eq 'directory') {
        [System.IO.Directory]::Move($source, $env:AIDIY_EXPLORER_DESTINATION)
    } else {
        [System.IO.File]::Move($source, $env:AIDIY_EXPLORER_DESTINATION)
    }
    exit 0
}
if ($env:AIDIY_EXPLORER_ACTION -ne 'trash') { throw 'Unsupported operation' }
# SendToRecycleBin だけに頼らず、Shell が完全削除へ切り替える直前にも拒否する。
# https://learn.microsoft.com/windows/win32/api/shobjidl_core/nf-shobjidl_core-ifileoperationprogresssink-predeleteitem
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
namespace AiDiyExplorer {
 [ComImport, Guid("43826d1e-e718-42ee-bc55-a1e261c37bfe"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
 public interface IShellItem { }
 [Guid("04b0f1a7-9490-44bc-96e1-4296a31252e2"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown), ComVisible(true)]
 public interface IProgress {
  void StartOperations(); void FinishOperations(int result);
  void PreRenameItem(uint flags, IShellItem item, [MarshalAs(UnmanagedType.LPWStr)] string name);
  void PostRenameItem(uint flags, IShellItem item, [MarshalAs(UnmanagedType.LPWStr)] string name, int result, IShellItem created);
  void PreMoveItem(uint flags, IShellItem item, IShellItem destination, [MarshalAs(UnmanagedType.LPWStr)] string name);
  void PostMoveItem(uint flags, IShellItem item, IShellItem destination, [MarshalAs(UnmanagedType.LPWStr)] string name, int result, IShellItem created);
  void PreCopyItem(uint flags, IShellItem item, IShellItem destination, [MarshalAs(UnmanagedType.LPWStr)] string name);
  void PostCopyItem(uint flags, IShellItem item, IShellItem destination, [MarshalAs(UnmanagedType.LPWStr)] string name, int result, IShellItem created);
  void PreDeleteItem(uint flags, IShellItem item);
  void PostDeleteItem(uint flags, IShellItem item, int result, IShellItem created);
  void PreNewItem(uint flags, IShellItem destination, [MarshalAs(UnmanagedType.LPWStr)] string name);
  void PostNewItem(uint flags, IShellItem destination, [MarshalAs(UnmanagedType.LPWStr)] string name, [MarshalAs(UnmanagedType.LPWStr)] string template, uint attributes, int result, IShellItem created);
  void UpdateProgress(uint total, uint complete); void ResetTimer(); void PauseTimer(); void ResumeTimer();
 }
 [ComVisible(true), ClassInterface(ClassInterfaceType.None)]
 public class RecycleOnly : IProgress {
  public int Result = 0; public bool Recycled = false;
  public void StartOperations() {} public void FinishOperations(int result) { if (result < 0) Result = result; }
  public void PreRenameItem(uint f, IShellItem i, string n) {} public void PostRenameItem(uint f, IShellItem i, string n, int r, IShellItem c) {}
  public void PreMoveItem(uint f, IShellItem i, IShellItem d, string n) {} public void PostMoveItem(uint f, IShellItem i, IShellItem d, string n, int r, IShellItem c) {}
  public void PreCopyItem(uint f, IShellItem i, IShellItem d, string n) {} public void PostCopyItem(uint f, IShellItem i, IShellItem d, string n, int r, IShellItem c) {}
  public void PreDeleteItem(uint flags, IShellItem item) {
   // TSF_DELETE_RECYCLE_IF_POSSIBLE が無い実削除は E_ABORT で中断。
   if ((flags & 0x80) == 0) throw new COMException("Recycle Bin unavailable; permanent deletion refused.", unchecked((int)0x80004004));
  }
  public void PostDeleteItem(uint flags, IShellItem item, int result, IShellItem created) {
   if (result < 0) Result = result;
   if (result >= 0 && created != null) Recycled = true;
  }
  public void PreNewItem(uint f, IShellItem d, string n) {} public void PostNewItem(uint f, IShellItem d, string n, string t, uint a, int r, IShellItem c) {}
  public void UpdateProgress(uint t, uint c) {} public void ResetTimer() {} public void PauseTimer() {} public void ResumeTimer() {}
 }
 [ComImport, Guid("947aab5f-0a5c-4c13-b4d6-4bf7836fc9f8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
 public interface IOperation {
  void Advise(IProgress sink, out uint cookie); void Unadvise(uint cookie); void SetOperationFlags(uint flags);
  void SetProgressMessage([MarshalAs(UnmanagedType.LPWStr)] string message); void SetProgressDialog(IntPtr dialog); void SetProperties(IntPtr properties); void SetOwnerWindow(IntPtr window);
  void ApplyPropertiesToItem(IShellItem item); void ApplyPropertiesToItems(IntPtr items);
  void RenameItem(IShellItem item, [MarshalAs(UnmanagedType.LPWStr)] string name, IProgress sink); void RenameItems(IntPtr items, [MarshalAs(UnmanagedType.LPWStr)] string name);
  void MoveItem(IShellItem item, IShellItem destination, [MarshalAs(UnmanagedType.LPWStr)] string name, IProgress sink); void MoveItems(IntPtr items, IShellItem destination);
  void CopyItem(IShellItem item, IShellItem destination, [MarshalAs(UnmanagedType.LPWStr)] string name, IProgress sink); void CopyItems(IntPtr items, IShellItem destination);
  void DeleteItem(IShellItem item, IProgress sink); void DeleteItems(IntPtr items);
  void NewItem(IShellItem destination, uint attributes, [MarshalAs(UnmanagedType.LPWStr)] string name, [MarshalAs(UnmanagedType.LPWStr)] string template, IProgress sink);
  void PerformOperations(); void GetAnyOperationsAborted([MarshalAs(UnmanagedType.Bool)] out bool aborted);
 }
 public static class Trash {
  [DllImport("shell32.dll", CharSet=CharSet.Unicode, ExactSpelling=true, PreserveSig=false)]
  static extern void SHCreateItemFromParsingName(string path, IntPtr context, ref Guid iid, out IShellItem item);
  public static void Move(string path) {
   if (Environment.OSVersion.Version < new Version(6, 2)) throw new PlatformNotSupportedException("Recycle-only operation requires Windows 8 or later.");
   if (new System.IO.DriveInfo(System.IO.Path.GetPathRoot(path)).DriveType != System.IO.DriveType.Fixed)
    throw new InvalidOperationException("Recycle-only operation requires a local fixed drive.");
   IShellItem item = null; IOperation operation = null;
   try {
    Guid iid = typeof(IShellItem).GUID; SHCreateItemFromParsingName(path, IntPtr.Zero, ref iid, out item);
    operation = (IOperation)Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("3ad05575-8857-4850-9277-11b85bdb8e09")));
    // Undo record + recycle only + abort on error + no progress/error/confirmation UI.
    operation.SetOperationFlags(0x20000000 | 0x00080000 | 0x00100000 | 0x0400 | 0x0010 | 0x0004);
    RecycleOnly sink = new RecycleOnly(); operation.DeleteItem(item, sink); operation.PerformOperations();
    bool aborted; operation.GetAnyOperationsAborted(out aborted);
    if (sink.Result < 0) Marshal.ThrowExceptionForHR(sink.Result);
    if (aborted || !sink.Recycled) throw new InvalidOperationException("Recycle Bin operation did not complete. Check the original location and Recycle Bin before retrying.");
    GC.KeepAlive(sink);
   } finally { if (item != null) Marshal.FinalReleaseComObject(item); if (operation != null) Marshal.FinalReleaseComObject(operation); }
  }
 }
}
'@
[AiDiyExplorer.Trash]::Move($source)
