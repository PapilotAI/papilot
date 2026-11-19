"""One file operation, invoked over SSH with a JSON request on standard input."""
import codecs
import fcntl
import hashlib
import json
import os
import secrets
import stat
import sys

LIMIT = 2_000_000  # Same document size as Papilot's manuscript editor.
DIRECTORY = os.O_DIRECTORY | os.O_NOFOLLOW
SEARCH = getattr(os, "O_PATH", getattr(os, "O_SEARCH", os.O_RDONLY)) | DIRECTORY
CONFLICT = "conflict"


def revision(data):
    return hashlib.sha256(data).hexdigest()


def listing(directory):
    entries = []
    with os.scandir(directory) as items:
        for entry in items:
            if entry.name.startswith("."):
                continue
            folder = entry.is_dir(follow_symlinks=False)
            if folder or entry.is_file(follow_symlinks=False):
                entries.append({"name": entry.name, "folder": folder})
    return sorted(entries, key=lambda e: (not e["folder"], e["name"].casefold(), e["name"]))


def source(file):
    raw = file.read(LIMIT + 1)
    if len(raw) > LIMIT or b"\x00" in raw:
        raise ValueError("text-limit")
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise ValueError("text-limit") from None
    return raw, text.replace("\r\n", "\n").replace("\r", "\n")


def save(directory, name, file, original, request, raw, text):
    if request["text"] == text:
        return {"revision": revision(raw)}
    if revision(raw) != request["revision"]:
        raise ValueError(CONFLICT)
    if original.st_nlink != 1:
        raise ValueError("hard-link")
    remainder = raw.replace(b"\r\n", b"")
    if sum((b"\r\n" in raw, b"\r" in remainder, b"\n" in remainder)) > 1:
        raise ValueError("mixed-endings")
    newline = "\r\n" if b"\r\n" in raw else "\r" if b"\r" in raw else "\n"
    data = request["text"].replace("\n", newline).encode("utf-8")
    if raw.startswith(codecs.BOM_UTF8):
        data = codecs.BOM_UTF8 + data
    if len(data) > LIMIT or b"\x00" in data:
        raise ValueError("text-limit")
    temporary = ".papilot-" + secrets.token_hex(16)
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600, dir_fd=directory)
    try:
        with os.fdopen(fd, "wb") as out:
            out.write(data)
            out.flush()
            new = os.fstat(out.fileno())
            if (original.st_uid, original.st_gid) != (new.st_uid, new.st_gid):
                os.fchown(out.fileno(), original.st_uid, original.st_gid)
            os.fchmod(out.fileno(), stat.S_IMODE(original.st_mode) & 0o777)
            if sys.platform == "darwin":
                # Python omits Darwin's xattr API. fcopyfile also copies ACLs.
                import ctypes
                libc = ctypes.CDLL(None, use_errno=True)
                if libc.fcopyfile(file.fileno(), out.fileno(), None, 0x01 | 0x04):
                    number = ctypes.get_errno()
                    raise OSError(number, os.strerror(number))
            elif hasattr(os, "listxattr"):
                keys = os.listxattr(file.fileno())
                # Drop a directory default ACL that was absent on the source.
                acl = "system.posix_acl_access"
                if acl not in keys and acl in os.listxattr(out.fileno()):
                    os.removexattr(out.fileno(), acl)
                for key in keys:
                    os.setxattr(out.fileno(), key, os.getxattr(file.fileno(), key))
            os.fsync(out.fileno())
        current = os.stat(name, dir_fd=directory, follow_symlinks=False)
        if not os.path.samestat(original, current) or current.st_ctime_ns != original.st_ctime_ns:
            raise ValueError(CONFLICT)
        os.replace(temporary, name, src_dir_fd=directory, dst_dir_fd=directory)
    finally:
        try:
            os.unlink(temporary, dir_fd=directory)
        except FileNotFoundError:
            pass
    return {"revision": revision(data)}


def handle(request):
    action = request["action"]
    root = request["root"]
    if request.get("resolveRoot"):
        root = os.path.realpath(os.path.expanduser(root))
    if not os.path.isabs(root) or os.path.normpath(root) != root:
        raise ValueError("Invalid file path.")
    parts = request.get("path", "").split("/") if request.get("path") else []
    if any(part in ("", ".", "..") for part in parts):
        raise ValueError("Invalid file path.")
    browsing = action in ("browse", "list")
    if not browsing and (not parts or action not in ("read", "save")):
        raise ValueError("Invalid file path.")
    # Walk the canonical root and the requested directories without following
    # symlinks. A shared ancestor can grant search permission but not listing.
    parents = [part for part in root.split("/") if part] + (parts if browsing else parts[:-1])
    directory = os.open("/", SEARCH)
    try:
        for part in parents:
            child = os.open(part, SEARCH, dir_fd=directory)
            os.close(directory)
            directory = child
        if browsing or action == "save":
            readable = os.open(".", os.O_RDONLY | DIRECTORY, dir_fd=directory)
            os.close(directory)
            directory = readable
        if browsing:
            entries = listing(directory)
            if action == "browse":
                # Bound each preview response and the number of visible rows.
                size = 100
                pages = max(1, (len(entries) + size - 1) // size)
                page = min(request.get("page", 0), pages - 1)
                return {"root": root, "entries": entries[page * size:(page + 1) * size],
                        "page": page, "pages": pages}
            return {"root": root, "entries": entries}
        writing = action == "save"
        if writing:
            # All Papilot clients lock the same parent even across atomic renames.
            fcntl.flock(directory, fcntl.LOCK_EX)
        flags = (os.O_RDWR if writing else os.O_RDONLY) | os.O_NOFOLLOW | os.O_NONBLOCK
        fd = os.open(parts[-1], flags, dir_fd=directory)
        with os.fdopen(fd, "rb") as file:
            original = os.fstat(fd)
            if not stat.S_ISREG(original.st_mode):
                raise ValueError("text-limit")
            raw, text = source(file)
            if writing:
                return save(directory, parts[-1], file, original, request, raw, text)
            return {"text": text, "revision": revision(raw)}
    finally:
        os.close(directory)


try:
    result = handle(json.load(sys.stdin.buffer))
except (ValueError, OSError) as exc:
    result = {"error": str(exc)}
print(json.dumps(result, ensure_ascii=True))
