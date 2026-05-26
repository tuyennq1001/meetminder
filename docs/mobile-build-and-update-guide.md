# Mobile App — Build & Update Guide

Hướng dẫn build và cập nhật app `my-translator-mobile` (Expo + EAS) lên iPhone test.

Repo: `/Users/phucnt/workspace/my-translator-mobile`
ASC App ID: `6769454461` · Apple Team: `75EN938B6L` · Apple ID: `phucnt0@gmail.com`
EAS project: `260fa91a-49c1-44ae-b96a-f3de65e64e1f` (owner: `phuc-nt`)

---

## 2 cách cập nhật lên iPhone

| Cách | Khi nào dùng | Thời gian | App version |
|---|---|---|---|
| **OTA Update** (`eas update`) | Chỉ sửa JS/TS/asset, KHÔNG bump `version` trong `app.json` | ~30 giây | Giữ nguyên |
| **TestFlight Build mới** (`eas build` + `eas submit`) | Sửa native code, đổi plugin/permissions, hoặc đã bump `version` | ~15-20 phút | Tăng |

**Lý do:** `app.json` có `"runtimeVersion": { "policy": "appVersion" }` → mỗi `version` (vd `0.4.2` vs `0.4.3`) có runtime riêng, OTA update KHÔNG cross-version. Nếu đã bump version, BẮT BUỘC phải build mới.

---

## Cách 1: OTA Update (nhanh)

**Điều kiện:** chỉ sửa JS/TS/asset, giữ nguyên `version` trong `app.json`.

```bash
cd /Users/phucnt/workspace/my-translator-mobile
eas update --branch production --message "mô tả ngắn"
```

Trên iPhone:
1. Mở app → **Settings → App updates → Check for updates**
2. App tải bản mới, prompt restart
3. Restart → bản mới chạy

**Channel mapping** (xem `eas.json`):
- `development` profile → branch `development`
- `preview` profile → branch `preview`
- `production` profile → branch `production` ← TestFlight build dùng cái này

---

## Cách 2: TestFlight Build mới

**Khi nào:**
- Đổi native code (Swift/Obj-C/Kotlin/Java)
- Thêm/xóa plugin native trong `app.json`
- Đổi permissions / `Info.plist` / `AndroidManifest`
- Bump `version` trong `app.json`
- Thay đổi `expo-secure-store` config, deep links scheme, v.v.

### Bước 1: Bump version

`app.json`:
```json
"version": "0.4.3"   // tăng lên trước khi build
```

`buildNumber` (iOS) tự tăng do `eas.json` có `"autoIncrement": true` ở profile `production`.

### Bước 2: Commit + push

```bash
cd /Users/phucnt/workspace/my-translator-mobile
git add -A
git commit -m "feat: ..."
git push origin main
```

### Bước 3: Build iOS production

```bash
cd /Users/phucnt/workspace/my-translator-mobile
eas build --platform ios --profile production --non-interactive --no-wait
```

- `--no-wait`: không block terminal, build chạy trên cloud
- Theo dõi tại URL log in ra, hoặc:
  ```bash
  eas build:view <build-id>
  ```
- Đợi `Status: finished` (~12-18 phút)

### Bước 4: Submit lên TestFlight

```bash
cd /Users/phucnt/workspace/my-translator-mobile
eas submit --platform ios --profile production --latest --non-interactive
```

- `--latest`: lấy build mới nhất đã finished
- `ascAppId` đã pin trong `eas.json` → chạy non-interactive được
- Mất ~2-5 phút để Apple process

### Bước 5: Cập nhật trên iPhone

1. Mở app **TestFlight** trên iPhone
2. Vào My Translator → bản mới hiện "Update" (hoặc "Install")
3. Tap Update → cài → mở app

---

## Workflow đầy đủ cho 1 release native

```bash
cd /Users/phucnt/workspace/my-translator-mobile

# 1. Bump version trong app.json (manual edit)
# 2. Type-check
npx tsc --noEmit

# 3. Commit + push
git add -A && git commit -m "feat: ..." && git push

# 4. Build (async)
eas build --platform ios --profile production --non-interactive --no-wait

# 5. Đợi build xong (~15 phút) — check status
eas build:view <build-id>

# 6. Submit
eas submit --platform ios --profile production --latest --non-interactive

# 7. Đợi Apple process (~5 phút) → mở TestFlight trên iPhone → Update
```

---

## Quick reference

```bash
# Xem builds gần đây
eas build:list --platform ios --limit 5

# Xem build cụ thể
eas build:view <build-id>

# Hủy build đang chạy
eas build:cancel <build-id>

# Xem updates đã push
eas update:list --branch production

# Rollback OTA update
eas update:roll-back-to-embedded --branch production
```

---

## Troubleshooting

**OTA không hiện trên iPhone:**
- Check `version` trong `app.json` khớp với app đã cài (cùng `runtimeVersion`)
- Đảm bảo update push lên đúng branch (`production` cho TestFlight build)
- Kill app hoàn toàn rồi mở lại → in-app update check

**`eas submit` lỗi "Set ascAppId":**
- Đã pin trong `eas.json` → `submit.production.ios.ascAppId = "6769454461"`
- Nếu vẫn lỗi, chạy interactive: `eas submit --platform ios` → đăng nhập Apple ID

**Build fail "Provisioning Profile":**
- Chạy interactive 1 lần để EAS regenerate credentials: `eas credentials`

**TestFlight không hiện build mới:**
- Apple cần 5-15 phút process binary
- Check email từ Apple — có thể bị reject vì missing export compliance (đã set `ITSAppUsesNonExemptEncryption: false` trong `app.json` để né)

---

## Native vs JS — quyết định nhanh

Chỉ thay đổi trong các file/folder này thì **OTA được**:
- `src/**` (JS/TS code)
- `app/**` (expo-router screens)
- `assets/**` (images, fonts non-native)
- `package.json` — CHỈ khi dep là pure JS (không có native module)

**BẮT BUỘC build mới** khi đổi:
- `app.json` (trừ `extra`, OTA URL có thể OTA được nhưng an toàn nhất là build)
- `ios/**`, `android/**` (nếu có prebuild)
- `package.json` thêm dep có native code (`expo-*` mới, react-native lib mới)
- `eas.json`
