package com.nasko.app;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.content.UriPermission;
import android.database.Cursor;
import android.net.Uri;
import android.os.Environment;
import android.provider.DocumentsContract;
import android.provider.MediaStore;
import android.util.Base64;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.OutputStream;
import java.util.regex.Pattern;

/**
 * Fichiers du téléphone, sans permission large : dossiers choisis par l'utilisateur (Storage Access Framework, autorisation persistante limitée à CE dossier)
 * et enregistrement dans la galerie / Téléchargements via MediaStore. Le JavaScript ne reçoit que des identifiants de documents ; seuls les arbres
 * réellement accordés par l'utilisateur sont acceptés (jamais une URI arbitraire d'une autre application).
 */
final class FilesBridge {
    static final int REQ_TREE = 12;
    private static final Pattern NAME = Pattern.compile("[^/\\\\\\p{Cntrl}]{1,120}");
    private final Activity act;
    private final NativeHttp.Sink sink;
    private long pendingTree = 0;

    FilesBridge(Activity act, NativeHttp.Sink sink) {
        this.act = act;
        this.sink = sink;
    }

    // ------------------------------------------------------------------ sélection d'un dossier
    void pickTree(long id) {
        pendingTree = id;
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        try {
            act.startActivityForResult(i, REQ_TREE);
        } catch (Exception e) {
            pendingTree = 0;
            sink.emit(id, "tree", "{\"error\":\"sélecteur de dossier indisponible\"}");
        }
    }

    void onTreeResult(int res, Intent data) {
        long id = pendingTree;
        pendingTree = 0;
        if (id == 0) return;
        if (res != Activity.RESULT_OK || data == null || data.getData() == null) {
            sink.emit(id, "tree", "{\"error\":\"aucun dossier choisi\"}");
            return;
        }
        Uri u = data.getData();
        try {
            act.getContentResolver().takePersistableUriPermission(u, Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            String docId = DocumentsContract.getTreeDocumentId(u);
            String name = docId.contains(":") ? docId.substring(docId.indexOf(':') + 1) : docId;
            if (name.isEmpty()) name = "Stockage interne";
            sink.emit(id, "tree", new JSONObject().put("uri", u.toString()).put("name", name.substring(name.lastIndexOf('/') + 1)).toString());
        } catch (Exception e) {
            sink.emit(id, "tree", "{\"error\":\"autorisation refusée\"}");
        }
    }

    private boolean granted(String tree) {
        for (UriPermission p : act.getContentResolver().getPersistedUriPermissions())
            if (p.getUri().toString().equals(tree) && p.isReadPermission() && p.isWritePermission()) return true;
        return false;
    }

    // ------------------------------------------------------------------ lecture d'un dossier
    String list(String tree, String docId) {
        JSONArray out = new JSONArray();
        if (!granted(tree)) return out.toString();
        Uri t = Uri.parse(tree);
        try {
            String parent = docId == null || docId.isEmpty() ? DocumentsContract.getTreeDocumentId(t) : docId;
            Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(t, parent);
            String[] cols = {DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME, DocumentsContract.Document.COLUMN_MIME_TYPE,
                    DocumentsContract.Document.COLUMN_SIZE, DocumentsContract.Document.COLUMN_LAST_MODIFIED};
            try (Cursor c = act.getContentResolver().query(children, cols, null, null, null)) {
                while (c != null && c.moveToNext() && out.length() < 2000) {
                    String mime = c.getString(2);
                    out.put(new JSONObject().put("id", c.getString(0)).put("name", c.getString(1)).put("mime", mime == null ? "" : mime)
                            .put("dir", DocumentsContract.Document.MIME_TYPE_DIR.equals(mime)).put("size", c.isNull(3) ? 0 : c.getLong(3)).put("mtime", c.isNull(4) ? 0 : c.getLong(4)));
                }
            }
        } catch (Exception ignored) {
        }
        return out.toString();
    }

    // ------------------------------------------------------------------ opérations : rename | delete | mkdir | move
    String op(String op, String argsJson) {
        try {
            JSONObject a = new JSONObject(argsJson);
            String tree = a.optString("tree");
            if (!granted(tree)) return err("dossier non autorisé");
            Uri t = Uri.parse(tree);
            ContentResolver cr = act.getContentResolver();
            switch (op) {
                case "rename": {
                    String name = a.optString("name");
                    if (!NAME.matcher(name).matches()) return err("nom invalide");
                    Uri r = DocumentsContract.renameDocument(cr, DocumentsContract.buildDocumentUriUsingTree(t, a.getString("doc")), name);
                    return r == null ? err("renommage refusé") : new JSONObject().put("ok", true).put("id", DocumentsContract.getDocumentId(r)).toString();
                }
                case "delete":
                    return DocumentsContract.deleteDocument(cr, DocumentsContract.buildDocumentUriUsingTree(t, a.getString("doc"))) ? ok() : err("suppression refusée");
                case "mkdir": {
                    String name = a.optString("name");
                    if (!NAME.matcher(name).matches()) return err("nom invalide");
                    Uri r = DocumentsContract.createDocument(cr, DocumentsContract.buildDocumentUriUsingTree(t, a.getString("parent")), DocumentsContract.Document.MIME_TYPE_DIR, name);
                    return r == null ? err("création refusée") : new JSONObject().put("ok", true).put("id", DocumentsContract.getDocumentId(r)).toString();
                }
                case "move": {
                    Uri r = DocumentsContract.moveDocument(cr, DocumentsContract.buildDocumentUriUsingTree(t, a.getString("doc")),
                            DocumentsContract.buildDocumentUriUsingTree(t, a.getString("parent")), DocumentsContract.buildDocumentUriUsingTree(t, a.getString("target")));
                    return r == null ? err("déplacement refusé par ce dossier") : ok();
                }
                default:
                    return err("opération inconnue");
            }
        } catch (Exception e) {
            return err("échec : " + (e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage().replaceAll("content://\\S+", "")));
        }
    }

    private static String ok() {
        return "{\"ok\":true}";
    }

    private static String err(String m) {
        try {
            return new JSONObject().put("ok", false).put("error", m).toString();
        } catch (Exception e) {
            return "{\"ok\":false}";
        }
    }

    // ------------------------------------------------------------------ enregistrement dans la galerie / Téléchargements (MediaStore, sans permission)
    boolean saveMedia(String name, String mime, String b64, String collection) {
        try {
            String safe = name.replaceAll("[^\\p{L}\\p{N} ._\\-()]", "_");
            if (safe.isEmpty() || b64.length() > 70_000_000 || !mime.matches("[a-z]+/[a-z0-9.+\\-]+")) return false;
            boolean img = "images".equals(collection);
            ContentValues v = new ContentValues();
            v.put(MediaStore.MediaColumns.DISPLAY_NAME, safe);
            v.put(MediaStore.MediaColumns.MIME_TYPE, mime);
            v.put(MediaStore.MediaColumns.RELATIVE_PATH, (img ? Environment.DIRECTORY_PICTURES : Environment.DIRECTORY_DOWNLOADS) + "/ENOS");
            v.put(MediaStore.MediaColumns.IS_PENDING, 1);
            Uri base = img ? MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY) : MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);
            ContentResolver cr = act.getContentResolver();
            Uri u = cr.insert(base, v);
            if (u == null) return false;
            try (OutputStream out = cr.openOutputStream(u)) {
                out.write(Base64.decode(b64, Base64.DEFAULT));
            }
            ContentValues done = new ContentValues();
            done.put(MediaStore.MediaColumns.IS_PENDING, 0);
            cr.update(u, done, null, null);
            return true;
        } catch (Exception e) {
            return false;
        }
    }
}
