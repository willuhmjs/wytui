<script lang="ts">
  import { onMount } from "svelte";

  let url = $state("");
  let selectedProfileId = $state("");
  let saveToLibrary = $state(false);
  let profiles = $state<any[]>([]);
  let loading = $state(false);
  let error = $state("");
  let libraryConfigured = $state(false);
  let advancedMode = $state(false);
  let savingProfile = $state(false);
  let showSaveDialog = $state(false);
  let newProfileName = $state("");

  // Basic mode stackable options
  let basicOptions = $state({ sponsorblock: false, subtitles: false, metadata: false });
  let audioQuality = $state("0");

  // Advanced flag state
  let flags = $state<Record<string, { enabled: boolean; value: string }>>({});

  type FlagType = "bool" | "text" | "number" | "select";
  type FlagDef = {
    key: string;
    flag: string;
    label: string;
    type: FlagType;
    options?: string[];
    placeholder?: string;
    defaultValue?: string;
  };

  const YTDLP_DOCS = "https://github.com/yt-dlp/yt-dlp";

  const MEDIA_FORMATS = [
    "mp4", "mkv", "webm", "flv", "mov", "avi", "gif",
    "aac", "flac", "mp3", "ogg", "opus", "wav",
  ];

  const FLAG_DEFINITIONS: {
    category: string;
    docsAnchor: string;
    flags: FlagDef[];
  }[] = [
    {
      category: "Format & Quality",
      docsAnchor: "#video-format-options",
      flags: [
        {
          key: "format",
          flag: "-f",
          label: "Format",
          type: "text",
          placeholder: "bestvideo+bestaudio/best",
        },
        {
          key: "format_sort",
          flag: "-S",
          label: "Format sort",
          type: "text",
          placeholder: "res,ext:mp4:m4a",
        },
        {
          key: "merge_output",
          flag: "--merge-output-format",
          label: "Merge output format",
          type: "select",
          options: ["mp4", "mkv", "webm", "flv", "ogg"],
        },
        {
          key: "remux_video",
          flag: "--remux-video",
          label: "Remux video",
          type: "select",
          options: MEDIA_FORMATS,
        },
        {
          key: "recode_video",
          flag: "--recode-video",
          label: "Recode video",
          type: "select",
          options: MEDIA_FORMATS,
        },
      ],
    },
    {
      category: "Audio",
      docsAnchor: "#video-format-options",
      flags: [
        {
          key: "extract_audio",
          flag: "-x",
          label: "Extract audio",
          type: "bool",
        },
        {
          key: "audio_format",
          flag: "--audio-format",
          label: "Audio format",
          type: "select",
          options: [
            "best",
            "mp3",
            "aac",
            "flac",
            "opus",
            "m4a",
            "vorbis",
            "wav",
            "alac",
          ],
        },
        {
          key: "audio_quality",
          flag: "--audio-quality",
          label: "Audio quality",
          type: "text",
          placeholder: "0 (best) to 10 (worst) or 128K",
          defaultValue: "5",
        },
      ],
    },
    {
      category: "Subtitles",
      docsAnchor: "#subtitle-options",
      flags: [
        {
          key: "write_subs",
          flag: "--write-subs",
          label: "Write subtitles",
          type: "bool",
        },
        {
          key: "write_auto_subs",
          flag: "--write-auto-subs",
          label: "Write auto subtitles",
          type: "bool",
        },
        {
          key: "embed_subs",
          flag: "--embed-subs",
          label: "Embed subtitles",
          type: "bool",
        },
        {
          key: "sub_format",
          flag: "--sub-format",
          label: "Subtitle format",
          type: "select",
          options: ["srt", "ass", "vtt", "lrc"],
        },
        {
          key: "sub_langs",
          flag: "--sub-langs",
          label: "Subtitle languages",
          type: "text",
          placeholder: "en,es or all",
        },
        {
          key: "convert_subs",
          flag: "--convert-subs",
          label: "Convert subtitles",
          type: "select",
          options: ["srt", "ass", "vtt", "lrc", "none"],
        },
      ],
    },
    {
      category: "Thumbnails",
      docsAnchor: "#thumbnail-options",
      flags: [
        {
          key: "write_thumbnail",
          flag: "--write-thumbnail",
          label: "Write thumbnail",
          type: "bool",
        },
        {
          key: "embed_thumbnail",
          flag: "--embed-thumbnail",
          label: "Embed thumbnail",
          type: "bool",
        },
        {
          key: "convert_thumbnails",
          flag: "--convert-thumbnails",
          label: "Convert thumbnails",
          type: "select",
          options: ["jpg", "png", "webp", "none"],
        },
      ],
    },
    {
      category: "Metadata",
      docsAnchor: "#post-processing-options",
      flags: [
        {
          key: "embed_metadata",
          flag: "--embed-metadata",
          label: "Embed metadata",
          type: "bool",
        },
        {
          key: "embed_chapters",
          flag: "--embed-chapters",
          label: "Embed chapters",
          type: "bool",
        },
        {
          key: "embed_info_json",
          flag: "--embed-info-json",
          label: "Embed info JSON",
          type: "bool",
        },
        {
          key: "write_info_json",
          flag: "--write-info-json",
          label: "Write info JSON",
          type: "bool",
        },
        {
          key: "write_description",
          flag: "--write-description",
          label: "Write description",
          type: "bool",
        },
        {
          key: "write_comments",
          flag: "--write-comments",
          label: "Write comments",
          type: "bool",
        },
      ],
    },
    {
      category: "Network",
      docsAnchor: "#network-options",
      flags: [
        {
          key: "proxy",
          flag: "--proxy",
          label: "Proxy",
          type: "text",
          placeholder: "socks5://127.0.0.1:1080",
        },
        {
          key: "socket_timeout",
          flag: "--socket-timeout",
          label: "Socket timeout",
          type: "number",
          placeholder: "seconds",
        },
        {
          key: "source_address",
          flag: "--source-address",
          label: "Source address",
          type: "text",
          placeholder: "0.0.0.0",
        },
        {
          key: "force_ipv4",
          flag: "--force-ipv4",
          label: "Force IPv4",
          type: "bool",
        },
        {
          key: "force_ipv6",
          flag: "--force-ipv6",
          label: "Force IPv6",
          type: "bool",
        },
        {
          key: "impersonate",
          flag: "--impersonate",
          label: "Impersonate client",
          type: "text",
          placeholder: "chrome",
        },
      ],
    },
    {
      category: "Download",
      docsAnchor: "#download-options",
      flags: [
        {
          key: "concurrent_fragments",
          flag: "-N",
          label: "Concurrent fragments",
          type: "number",
          placeholder: "threads",
          defaultValue: "1",
        },
        {
          key: "limit_rate",
          flag: "-r",
          label: "Rate limit",
          type: "text",
          placeholder: "50K or 4.2M",
        },
        {
          key: "retries",
          flag: "-R",
          label: "Retries",
          type: "number",
          placeholder: "count",
          defaultValue: "10",
        },
        {
          key: "fragment_retries",
          flag: "--fragment-retries",
          label: "Fragment retries",
          type: "number",
          placeholder: "count",
          defaultValue: "10",
        },
        {
          key: "file_access_retries",
          flag: "--file-access-retries",
          label: "File access retries",
          type: "number",
          placeholder: "count",
          defaultValue: "3",
        },
        {
          key: "throttled_rate",
          flag: "--throttled-rate",
          label: "Throttled rate",
          type: "text",
          placeholder: "100K",
        },
        {
          key: "http_chunk_size",
          flag: "--http-chunk-size",
          label: "HTTP chunk size",
          type: "text",
          placeholder: "10M",
        },
        {
          key: "buffer_size",
          flag: "--buffer-size",
          label: "Buffer size",
          type: "text",
          placeholder: "1024 or 16K",
          defaultValue: "1024",
        },
        {
          key: "downloader",
          flag: "--downloader",
          label: "External downloader",
          type: "text",
          placeholder: "aria2c",
        },
        {
          key: "downloader_args",
          flag: "--downloader-args",
          label: "Downloader args",
          type: "text",
          placeholder: 'aria2c:"-x 16 -s 16"',
        },
        {
          key: "download_sections",
          flag: "--download-sections",
          label: "Download sections",
          type: "text",
          placeholder: "*10:15-inf",
        },
      ],
    },
    {
      category: "Video Selection",
      docsAnchor: "#video-selection",
      flags: [
        {
          key: "playlist_items",
          flag: "-I",
          label: "Playlist items",
          type: "text",
          placeholder: "1,3-5,7:2",
        },
        {
          key: "date",
          flag: "--date",
          label: "Exact date",
          type: "text",
          placeholder: "YYYYMMDD",
        },
        {
          key: "datebefore",
          flag: "--datebefore",
          label: "Date before",
          type: "text",
          placeholder: "YYYYMMDD",
        },
        {
          key: "dateafter",
          flag: "--dateafter",
          label: "Date after",
          type: "text",
          placeholder: "YYYYMMDD",
        },
        {
          key: "match_filters",
          flag: "--match-filters",
          label: "Match filters",
          type: "text",
          placeholder: "duration>60",
        },
        {
          key: "min_filesize",
          flag: "--min-filesize",
          label: "Min filesize",
          type: "text",
          placeholder: "50k",
        },
        {
          key: "max_filesize",
          flag: "--max-filesize",
          label: "Max filesize",
          type: "text",
          placeholder: "500M",
        },
        {
          key: "age_limit",
          flag: "--age-limit",
          label: "Age limit",
          type: "number",
          placeholder: "years",
        },
        {
          key: "max_downloads",
          flag: "--max-downloads",
          label: "Max downloads",
          type: "number",
          placeholder: "count",
        },
        {
          key: "skip_playlist_errors",
          flag: "--skip-playlist-after-errors",
          label: "Skip playlist after errors",
          type: "number",
          placeholder: "count",
        },
        {
          key: "no_playlist",
          flag: "--no-playlist",
          label: "No playlist (single video)",
          type: "bool",
        },
        {
          key: "download_archive",
          flag: "--download-archive",
          label: "Download archive file",
          type: "text",
          placeholder: "/path/to/archive.txt",
        },
        {
          key: "break_on_existing",
          flag: "--break-on-existing",
          label: "Break on existing",
          type: "bool",
        },
      ],
    },
    {
      category: "Filesystem",
      docsAnchor: "#filesystem-options",
      flags: [
        {
          key: "output_template",
          flag: "-o",
          label: "Output template",
          type: "text",
          placeholder: "%(title)s.%(ext)s",
        },
        {
          key: "no_overwrites",
          flag: "--no-overwrites",
          label: "No overwrites",
          type: "bool",
        },
        {
          key: "force_overwrites",
          flag: "--force-overwrites",
          label: "Force overwrites",
          type: "bool",
        },
        {
          key: "no_continue",
          flag: "--no-continue",
          label: "No continue (restart)",
          type: "bool",
        },
        {
          key: "no_part",
          flag: "--no-part",
          label: "No .part files",
          type: "bool",
        },
        {
          key: "no_mtime",
          flag: "--no-mtime",
          label: "No mtime",
          type: "bool",
        },
        {
          key: "restrict_filenames",
          flag: "--restrict-filenames",
          label: "Restrict filenames",
          type: "bool",
        },
        {
          key: "trim_filenames",
          flag: "--trim-filenames",
          label: "Trim filenames",
          type: "number",
          placeholder: "characters",
        },
        {
          key: "cookies",
          flag: "--cookies",
          label: "Cookies file",
          type: "text",
          placeholder: "/path/to/cookies.txt",
        },
      ],
    },
    {
      category: "SponsorBlock",
      docsAnchor: "#sponsorblock-options",
      flags: [
        {
          key: "sponsorblock_mark",
          flag: "--sponsorblock-mark",
          label: "Mark categories",
          type: "text",
          placeholder: "sponsor,intro,outro,all",
        },
        {
          key: "sponsorblock_remove",
          flag: "--sponsorblock-remove",
          label: "Remove categories",
          type: "text",
          placeholder: "sponsor,selfpromo",
        },
        {
          key: "no_sponsorblock",
          flag: "--no-sponsorblock",
          label: "Disable SponsorBlock",
          type: "bool",
        },
      ],
    },
    {
      category: "Post-Processing",
      docsAnchor: "#post-processing-options",
      flags: [
        {
          key: "postprocessor_args",
          flag: "--postprocessor-args",
          label: "Post-processor args",
          type: "text",
          placeholder: "ffmpeg:-c:a aac -b:a 192k",
        },
        {
          key: "keep_video",
          flag: "-k",
          label: "Keep video after PP",
          type: "bool",
        },
        {
          key: "split_chapters",
          flag: "--split-chapters",
          label: "Split chapters",
          type: "bool",
        },
        {
          key: "remove_chapters",
          flag: "--remove-chapters",
          label: "Remove chapters",
          type: "text",
          placeholder: "regex pattern",
        },
        {
          key: "force_keyframes",
          flag: "--force-keyframes-at-cuts",
          label: "Force keyframes at cuts",
          type: "bool",
        },
        {
          key: "fixup",
          flag: "--fixup",
          label: "Fixup policy",
          type: "select",
          options: ["never", "warn", "detect_or_warn", "force"],
          defaultValue: "detect_or_warn",
        },
        {
          key: "concat_playlist",
          flag: "--concat-playlist",
          label: "Concat playlist",
          type: "select",
          options: ["never", "always", "multi_video"],
          defaultValue: "never",
        },
      ],
    },
    {
      category: "Workarounds",
      docsAnchor: "#workarounds",
      flags: [
        {
          key: "no_check_certs",
          flag: "--no-check-certificates",
          label: "Skip certificate check",
          type: "bool",
        },
        {
          key: "legacy_server",
          flag: "--legacy-server-connect",
          label: "Legacy server connect",
          type: "bool",
        },
        {
          key: "sleep_requests",
          flag: "--sleep-requests",
          label: "Sleep between requests",
          type: "number",
          placeholder: "seconds",
        },
        {
          key: "sleep_interval",
          flag: "--sleep-interval",
          label: "Sleep interval",
          type: "number",
          placeholder: "seconds",
        },
        {
          key: "max_sleep_interval",
          flag: "--max-sleep-interval",
          label: "Max sleep interval",
          type: "number",
          placeholder: "seconds",
        },
        {
          key: "sleep_subtitles",
          flag: "--sleep-subtitles",
          label: "Sleep between subtitles",
          type: "number",
          placeholder: "seconds",
        },
        {
          key: "add_headers",
          flag: "--add-headers",
          label: "Add headers",
          type: "text",
          placeholder: "Referer:https://example.com",
        },
      ],
    },
    {
      category: "Extractor",
      docsAnchor: "#extractor-options",
      flags: [
        {
          key: "extractor_retries",
          flag: "--extractor-retries",
          label: "Extractor retries",
          type: "number",
          placeholder: "count",
          defaultValue: "3",
        },
        {
          key: "extractor_args",
          flag: "--extractor-args",
          label: "Extractor args",
          type: "text",
          placeholder: "youtube:player_client=web",
        },
      ],
    },
    {
      category: "General",
      docsAnchor: "#general-options",
      flags: [
        {
          key: "ignore_errors",
          flag: "-i",
          label: "Ignore errors",
          type: "bool",
        },
        {
          key: "flat_playlist",
          flag: "--flat-playlist",
          label: "Flat playlist (list only)",
          type: "bool",
        },
        {
          key: "live_from_start",
          flag: "--live-from-start",
          label: "Live from start",
          type: "bool",
        },
        {
          key: "prefer_free_formats",
          flag: "--prefer-free-formats",
          label: "Prefer free formats",
          type: "bool",
        },
      ],
    },
  ];

  let expandedCategories = $state<Set<string>>(new Set());

  function toggleCategory(cat: string) {
    const next = new Set(expandedCategories);
    if (next.has(cat)) next.delete(cat);
    else next.add(cat);
    expandedCategories = next;
  }

  function buildBasicFlags(): string[] {
    const result: string[] = [];
    if (basicOptions.sponsorblock) {
      result.push("--sponsorblock-remove", "sponsor,selfpromo");
    }
    if (basicOptions.subtitles) {
      result.push("--write-subs", "--write-auto-subs", "--embed-subs", "--sub-langs", "en");
    }
    if (basicOptions.metadata) {
      result.push("--embed-metadata", "--embed-chapters");
    }
    const profile = profiles.find((p: any) => p.id === selectedProfileId);
    if (saveToLibrary && !(profile?.audioOnly)) {
      result.push("--write-thumbnail");
    }
    if (profile && !profile.audioOnly && audioQuality !== "0") {
      result.push("--audio-quality", audioQuality);
    }
    return result;
  }

  function buildCustomFlags(): string[] {
    const result: string[] = [];
    for (const cat of FLAG_DEFINITIONS) {
      for (const f of cat.flags) {
        const state = flags[f.key];
        if (!state?.enabled) continue;
        if (f.defaultValue && state.value === f.defaultValue) continue;
        if (f.type === "bool") {
          result.push(f.flag);
        } else if (state.value.trim()) {
          result.push(f.flag, state.value.trim());
        }
      }
    }
    return result;
  }

  function loadProfileFlags(profile: any) {
    const state: Record<string, { enabled: boolean; value: string }> = {};
    for (const cat of FLAG_DEFINITIONS) {
      for (const f of cat.flags) {
        state[f.key] = f.defaultValue
          ? { enabled: true, value: f.defaultValue }
          : { enabled: false, value: "" };
      }
    }

    const catsToExpand = new Set<string>();
    if (profile?.customFlags?.length) {
      const cf = profile.customFlags as string[];
      const flagByStr = new Map(
        FLAG_DEFINITIONS.flatMap((c) => c.flags).map((f) => [f.flag, f]),
      );
      let i = 0;
      while (i < cf.length) {
        const token = cf[i];
        const def = flagByStr.get(token);
        if (def) {
          let val = "";
          if (def.type !== "bool" && i + 1 < cf.length) {
            val = cf[i + 1];
            i++;
          }
          state[def.key] = { enabled: true, value: val };
          const cat = FLAG_DEFINITIONS.find((c) =>
            c.flags.some((f) => f.key === def.key),
          );
          if (cat) catsToExpand.add(cat.category);
        }
        i++;
      }
    }

    flags = state;
    expandedCategories = catsToExpand;
  }

  const defaultFlagKeys = new Set(
    FLAG_DEFINITIONS.flatMap((c) => c.flags)
      .filter((f) => f.defaultValue)
      .map((f) => f.key),
  );
  let enabledFlagCount = $derived(
    Object.entries(flags).filter(
      ([k, f]) => f.enabled && !defaultFlagKeys.has(k),
    ).length,
  );

  onMount(async () => {
    const [profilesRes, settingsRes] = await Promise.all([
      fetch("/api/profiles"),
      fetch("/api/settings"),
    ]);
    if (profilesRes.ok) {
      profiles = await profilesRes.json();
      const defaultProfile = profiles.find((p: any) => p.isDefault);
      if (defaultProfile) {
        selectedProfileId = defaultProfile.id;
        loadProfileFlags(defaultProfile);
      }
    }
    if (settingsRes.ok) {
      const settings = await settingsRes.json();
      libraryConfigured = !!(settings.libraryPath || settings.musicLibraryPath);
    }
  });

  async function handleSubmit(e: Event) {
    e.preventDefault();
    error = "";

    if (!url || !selectedProfileId) {
      error = "Please enter a URL and select a profile";
      return;
    }

    loading = true;

    try {
      const body: any = { url, profileId: selectedProfileId, saveToLibrary };
      if (advancedMode) {
        const cf = buildCustomFlags();
        if (cf.length > 0) body.customFlags = cf;
      } else {
        const bf = buildBasicFlags();
        if (bf.length > 0) body.customFlags = bf;
      }

      const res = await fetch("/api/downloads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed to create download");
      }

      url = "";
      saveToLibrary = false;
    } catch (e: any) {
      error = e.message;
    } finally {
      loading = false;
    }
  }

  async function handleSaveProfile() {
    if (!newProfileName.trim()) return;
    savingProfile = true;
    try {
      const res = await fetch("/api/profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newProfileName.trim(),
          customFlags: buildCustomFlags(),
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed to save profile");
      }
      const profile = await res.json();
      const idx = profiles.findIndex((p) => p.id === profile.id);
      if (idx >= 0) {
        profiles[idx] = profile;
        profiles = [...profiles];
      } else {
        profiles = [...profiles, profile];
      }
      selectedProfileId = profile.id;
      showSaveDialog = false;
      newProfileName = "";
    } catch (e: any) {
      error = e.message;
    } finally {
      savingProfile = false;
    }
  }

  function resetToDefaults() {
    const sysDefault = profiles.find((p: any) => p.isDefault);
    if (sysDefault) {
      selectedProfileId = sysDefault.id;
      loadProfileFlags(sysDefault);
    }
    newProfileName = "";
    showSaveDialog = false;
  }

  function selectProfile(id: string) {
    selectedProfileId = id;
    if (advancedMode) {
      const profile = profiles.find((p) => p.id === id);
      if (profile) loadProfileFlags(profile);
    }
    if (showSaveDialog) {
      const custom = customProfiles.find((p) => p.id === id);
      newProfileName = custom ? custom.name : "";
    }
  }

  function handleFormClick(e: MouseEvent) {
    if (!advancedMode) return;
    if (!customProfiles.some((p) => p.id === selectedProfileId)) return;
    const target = e.target as HTMLElement;
    if (target.closest(".advanced-panel, .profile-btn, .mode-toggle")) return;
    resetToDefaults();
  }

  let videoProfiles = $derived(
    profiles.filter((p: any) => p.isSystem && !p.audioOnly).slice(0, 4),
  );
  let audioProfiles = $derived(
    profiles.filter((p: any) => p.isSystem && p.audioOnly).slice(0, 3),
  );
  let customProfiles = $derived(profiles.filter((p: any) => !p.isSystem));
  let selectedIsVideoProfile = $derived(() => {
    const profile = profiles.find((p: any) => p.id === selectedProfileId);
    return profile && !profile.audioOnly;
  });
</script>

<div class="download-form">
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <form onsubmit={handleSubmit} onclick={handleFormClick}>
    <div class="form-header">
      <label for="url">Video URL</label>
      <button
        type="button"
        class="mode-toggle"
        class:active={advancedMode}
        onclick={() => {
          advancedMode = !advancedMode;
          if (advancedMode) {
            const profile = profiles.find((p) => p.id === selectedProfileId);
            if (profile) loadProfileFlags(profile);
          }
        }}
      >
        <span class="toggle-track">
          <span class="toggle-thumb"></span>
        </span>
        <span class="toggle-label">Advanced</span>
      </button>
    </div>

    <div class="form-group">
      <textarea
        id="url"
        bind:value={url}
        placeholder="Paste YouTube, TikTok, Twitter, or any supported URL..."
        rows="3"
        disabled={loading}
      ></textarea>
    </div>

    {#if libraryConfigured}
      <label class="checkbox-label library-toggle">
        <input
          type="checkbox"
          bind:checked={saveToLibrary}
          onchange={() => {
            if (saveToLibrary) {
              basicOptions.sponsorblock = true;
              basicOptions.subtitles = true;
              basicOptions.metadata = true;
            }
          }}
          disabled={loading}
        />
        Save to Library
      </label>
    {/if}

    {#if !advancedMode}
      <div class="profile-quick-select">
        <div class="profile-group">
          <span class="profile-group-label">Video</span>
          <div class="profile-buttons">
            {#each videoProfiles as profile}
              <button
                type="button"
                class="profile-btn"
                class:active={selectedProfileId === profile.id}
                onclick={() => selectProfile(profile.id)}
                disabled={loading}
              >
                {profile.name}{#if profile.isDefault}
                  *{/if}
              </button>
            {/each}
          </div>
        </div>

        <div class="profile-group">
          <span class="profile-group-label">Audio</span>
          <div class="profile-buttons">
            {#each audioProfiles as profile}
              <button
                type="button"
                class="profile-btn"
                class:active={selectedProfileId === profile.id}
                onclick={() => selectProfile(profile.id)}
                disabled={loading}
              >
                {profile.name}
              </button>
            {/each}
          </div>
        </div>

        <div class="profile-group">
          <span class="profile-group-label">Options</span>
          <div class="profile-buttons">
            <button
              type="button"
              class="profile-btn option-chip"
              class:active={basicOptions.sponsorblock}
              onclick={() => basicOptions.sponsorblock = !basicOptions.sponsorblock}
              disabled={loading}
            >
              SponsorBlock
            </button>
            <button
              type="button"
              class="profile-btn option-chip"
              class:active={basicOptions.subtitles}
              onclick={() => basicOptions.subtitles = !basicOptions.subtitles}
              disabled={loading}
            >
              Subtitles
            </button>
            <button
              type="button"
              class="profile-btn option-chip"
              class:active={basicOptions.metadata}
              onclick={() => basicOptions.metadata = !basicOptions.metadata}
              disabled={loading}
            >
              Metadata
            </button>
          </div>
        </div>

        {#if selectedIsVideoProfile()}
          <div class="profile-group">
            <span class="profile-group-label">Audio Quality</span>
            <div class="audio-quality-select">
              <select bind:value={audioQuality} disabled={loading}>
                <option value="0">High</option>
                <option value="5">Medium</option>
                <option value="9">Low</option>
              </select>
            </div>
          </div>
        {/if}
      </div>
    {:else if customProfiles.length > 0}
      <div class="profile-quick-select">
        <div class="profile-group">
          <span class="profile-group-label">Load Profile</span>
          <div class="profile-buttons">
            {#each customProfiles as profile}
              <button
                type="button"
                class="profile-btn custom"
                class:active={selectedProfileId === profile.id}
                onclick={() => selectProfile(profile.id)}
                disabled={loading}
              >
                {profile.name}
              </button>
            {/each}
          </div>
        </div>
      </div>
    {/if}

    {#if advancedMode}
      <div class="advanced-panel">
        <div class="advanced-header">
          <span class="advanced-title">
            {#if enabledFlagCount > 0}
              <span class="flag-count">{enabledFlagCount}</span>
            {/if}
          </span>
          <div class="advanced-actions">
            <button
              type="button"
              class="btn-save-profile"
              onclick={() => {
                const custom = customProfiles.find(
                  (p) => p.id === selectedProfileId,
                );
                newProfileName = custom ? custom.name : "";
                showSaveDialog = !showSaveDialog;
              }}
            >
              Save as
            </button>
            <button
              type="button"
              class="btn-clear-flags"
              onclick={resetToDefaults}
            >
              Reset
            </button>
          </div>
        </div>

        {#if showSaveDialog}
          <div class="save-dialog">
            <input
              type="text"
              bind:value={newProfileName}
              placeholder="Profile name..."
              onkeydown={(e) => e.key === "Enter" && handleSaveProfile()}
            />
            <button
              type="button"
              class="btn-sm btn-confirm"
              onclick={handleSaveProfile}
              disabled={savingProfile || !newProfileName.trim()}
            >
              {savingProfile ? "Saving..." : "Save"}
            </button>
            <button
              type="button"
              class="btn-sm btn-cancel"
              onclick={() => {
                showSaveDialog = false;
                newProfileName = "";
              }}
            >
              Cancel
            </button>
          </div>
        {/if}

        {#each FLAG_DEFINITIONS as category}
          {@const isExpanded = expandedCategories.has(category.category)}
          {@const activeCount = category.flags.filter(
            (f) => flags[f.key]?.enabled && !f.defaultValue,
          ).length}
          <div class="flag-category">
            <button
              type="button"
              class="category-header"
              onclick={() => toggleCategory(category.category)}
            >
              <span class="category-chevron" class:expanded={isExpanded}
                >&#9654;</span
              >
              <span class="category-name">{category.category}</span>
              <a
                href="{YTDLP_DOCS}{category.docsAnchor}"
                target="_blank"
                rel="noopener noreferrer"
                class="category-docs"
                onclick={(e) => e.stopPropagation()}
                title="Documentation"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path
                    d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"
                  />
                  <path
                    d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"
                  />
                </svg>
              </a>
              {#if activeCount > 0}
                <span class="category-count">{activeCount}</span>
              {/if}
            </button>
            {#if isExpanded}
              <div class="flag-list">
                {#each category.flags as f}
                  {@const state = flags[f.key]}
                  {#if f.defaultValue}
                    <div class="flag-row enabled default-flag">
                      <div class="flag-label-row">
                        <span class="flag-name">{f.label}</span>
                        <code class="flag-code">{f.flag}</code>
                      </div>
                      <div class="flag-value">
                        {#if f.type === "select"}
                          <select
                            value={state?.value ?? f.defaultValue}
                            onchange={(e) => {
                              flags[f.key] = {
                                ...flags[f.key],
                                value: (e.target as HTMLSelectElement).value,
                              };
                            }}
                          >
                            {#each f.options ?? [] as opt}
                              <option value={opt}>{opt}</option>
                            {/each}
                          </select>
                        {:else}
                          <input
                            type={f.type === "number" ? "number" : "text"}
                            value={state?.value ?? f.defaultValue}
                            placeholder={f.placeholder}
                            oninput={(e) => {
                              flags[f.key] = {
                                ...flags[f.key],
                                value: (e.target as HTMLInputElement).value,
                              };
                            }}
                          />
                        {/if}
                      </div>
                    </div>
                  {:else}
                    <div class="flag-row" class:enabled={state?.enabled}>
                      <label class="flag-toggle">
                        <input
                          type="checkbox"
                          checked={state?.enabled}
                          onchange={() => {
                            flags[f.key] = {
                              ...flags[f.key],
                              enabled: !flags[f.key].enabled,
                            };
                          }}
                        />
                        <span class="flag-name">{f.label}</span>
                        <code class="flag-code">{f.flag}</code>
                      </label>
                      {#if state?.enabled && f.type !== "bool"}
                        <div class="flag-value">
                          {#if f.type === "select"}
                            <select
                              value={state.value}
                              onchange={(e) => {
                                flags[f.key] = {
                                  ...flags[f.key],
                                  value: (e.target as HTMLSelectElement).value,
                                };
                              }}
                            >
                              <option value="">-- select --</option>
                              {#each f.options ?? [] as opt}
                                <option value={opt}>{opt}</option>
                              {/each}
                            </select>
                          {:else}
                            <input
                              type={f.type === "number" ? "number" : "text"}
                              value={state.value}
                              placeholder={f.placeholder}
                              oninput={(e) => {
                                flags[f.key] = {
                                  ...flags[f.key],
                                  value: (e.target as HTMLInputElement).value,
                                };
                              }}
                            />
                          {/if}
                        </div>
                      {/if}
                    </div>
                  {/if}
                {/each}
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {/if}

    {#if error}
      <div class="error-message">{error}</div>
    {/if}

    <button type="submit" class="btn btn-primary btn-lg" disabled={loading}>
      {#if loading}
        Downloading...
      {:else}
        Download
      {/if}
    </button>
  </form>
</div>

<style>
  .download-form {
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: var(--spacing-xl);
  }

  .form-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: var(--spacing-sm);
  }

  .form-header label {
    color: var(--text-secondary);
    font-size: 0.875rem;
    font-weight: 500;
    margin: 0;
  }

  .form-group {
    margin-bottom: var(--spacing-lg);
  }

  label {
    display: block;
    margin-bottom: var(--spacing-sm);
    color: var(--text-secondary);
    font-size: 0.875rem;
    font-weight: 500;
  }

  /* Mode toggle */
  .mode-toggle {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    background: none;
    border: none;
    cursor: pointer;
    padding: var(--spacing-xs) var(--spacing-sm);
    border-radius: var(--radius-md);
    transition: all var(--transition-fast);
  }

  .mode-toggle:hover {
    background: var(--bg-tertiary);
  }

  .toggle-track {
    position: relative;
    width: 36px;
    height: 20px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 10px;
    transition: all var(--transition-fast);
  }

  .mode-toggle.active .toggle-track {
    background: var(--accent-primary);
    border-color: var(--accent-primary);
  }

  .toggle-thumb {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 14px;
    height: 14px;
    background: white;
    border-radius: 50%;
    transition: transform var(--transition-fast);
  }

  .mode-toggle.active .toggle-thumb {
    transform: translateX(16px);
  }

  .toggle-label {
    font-size: 0.8125rem;
    color: var(--text-tertiary);
    font-weight: 500;
    transition: color var(--transition-fast);
  }

  .mode-toggle.active .toggle-label {
    color: var(--accent-primary);
  }

  /* Profiles */
  .profile-quick-select {
    margin-bottom: var(--spacing-lg);
    display: flex;
    flex-direction: column;
    gap: var(--spacing-md);
  }

  .profile-group {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-sm);
  }

  .profile-group-label {
    font-size: 0.75rem;
    color: var(--text-tertiary);
    text-transform: uppercase;
    font-weight: 600;
    letter-spacing: 0.05em;
  }

  .profile-buttons {
    display: flex;
    gap: var(--spacing-sm);
    flex-wrap: wrap;
  }

  .profile-btn {
    padding: var(--spacing-sm) var(--spacing-md);
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    color: var(--text-secondary);
    font-size: 0.875rem;
    cursor: pointer;
    transition: all var(--transition-fast);
  }

  .profile-btn:hover:not(:disabled) {
    background: var(--bg-hover);
    border-color: var(--accent-dim);
  }

  .profile-btn.active {
    background: transparent;
    border: 2px solid transparent;
    background-image:
      linear-gradient(var(--bg-tertiary), var(--bg-tertiary)),
      linear-gradient(90deg, #7c3aed, #ec4899, #3b82f6, #7c3aed);
    background-origin: border-box;
    background-clip: padding-box, border-box;
    background-size:
      100%,
      300% 100%;
    animation: rgb-border 8s linear infinite;
    color: var(--text-primary);
  }

  @keyframes rgb-border {
    0% {
      background-position:
        0 0,
        0% 0;
    }
    100% {
      background-position:
        0 0,
        300% 0;
    }
  }

  .option-chip {
    font-size: 0.8125rem;
  }

  .option-chip.active {
    background: transparent;
    border: 2px solid transparent;
    background-image:
      linear-gradient(var(--bg-tertiary), var(--bg-tertiary)),
      linear-gradient(90deg, #7c3aed, #ec4899, #3b82f6, #7c3aed);
    background-origin: border-box;
    background-clip: padding-box, border-box;
    background-size:
      100%,
      300% 100%;
    animation: rgb-border 8s linear infinite;
    color: var(--text-primary);
  }

  .audio-quality-select select {
    padding: var(--spacing-sm) var(--spacing-md);
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    color: var(--text-secondary);
    font-size: 0.875rem;
    cursor: pointer;
    transition: all var(--transition-fast);
  }

  .audio-quality-select select:focus {
    outline: none;
    border-color: var(--accent-primary);
  }

  .profile-btn.custom {
    border-style: dashed;
    border-color: var(--accent-dim);
  }

  .profile-btn.custom.active {
    border-style: solid;
  }

  .profile-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* Advanced panel */
  .advanced-panel {
    margin-bottom: var(--spacing-lg);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    overflow: hidden;
  }

  .advanced-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: var(--spacing-sm) var(--spacing-md);
    background: var(--bg-tertiary);
    border-bottom: 1px solid var(--border);
  }

  .advanced-title {
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--text-secondary);
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
  }

  .flag-count,
  .category-count {
    background: var(--accent-primary);
    color: white;
    font-size: 0.6875rem;
    font-weight: 700;
    padding: 1px 6px;
    border-radius: 10px;
    min-width: 18px;
    text-align: center;
  }

  .advanced-actions {
    display: flex;
    gap: var(--spacing-sm);
  }

  .btn-save-profile,
  .btn-clear-flags {
    padding: var(--spacing-xs) var(--spacing-sm);
    font-size: 0.75rem;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
    background: var(--bg-secondary);
    color: var(--text-secondary);
    cursor: pointer;
    transition: all var(--transition-fast);
  }

  .btn-save-profile:hover {
    background: var(--accent-primary);
    border-color: var(--accent-primary);
    color: white;
  }

  .btn-clear-flags:hover {
    background: var(--bg-hover);
  }

  /* Save dialog */
  .save-dialog {
    display: flex;
    gap: var(--spacing-sm);
    padding: var(--spacing-sm) var(--spacing-md);
    background: var(--bg-elevated);
    border-bottom: 1px solid var(--border);
  }

  .save-dialog input {
    flex: 1;
    padding: var(--spacing-xs) var(--spacing-sm);
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-size: 0.8125rem;
  }

  .save-dialog input:focus {
    outline: none;
    border-color: var(--accent-primary);
  }

  .btn-sm {
    padding: var(--spacing-xs) var(--spacing-sm);
    font-size: 0.75rem;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
    cursor: pointer;
    transition: all var(--transition-fast);
  }

  .btn-confirm {
    background: var(--accent-primary);
    border-color: var(--accent-primary);
    color: white;
  }

  .btn-confirm:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-cancel {
    background: var(--bg-tertiary);
    color: var(--text-secondary);
  }

  .btn-cancel:hover {
    background: var(--bg-hover);
  }

  /* Categories */
  .flag-category {
    border-bottom: 1px solid var(--border);
  }

  .flag-category:last-child {
    border-bottom: none;
  }

  .category-header {
    width: 100%;
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    padding: var(--spacing-sm) var(--spacing-md);
    background: none;
    border: none;
    color: var(--text-secondary);
    font-size: 0.8125rem;
    font-weight: 500;
    cursor: pointer;
    transition: background var(--transition-fast);
  }

  .category-header:hover {
    background: var(--bg-tertiary);
  }

  .category-chevron {
    font-size: 0.625rem;
    transition: transform var(--transition-fast);
    color: var(--text-tertiary);
  }

  .category-chevron.expanded {
    transform: rotate(90deg);
  }

  .category-name {
    flex: 1;
    text-align: left;
  }

  .category-docs {
    display: flex;
    align-items: center;
    color: var(--text-tertiary);
    opacity: 0;
    transition:
      opacity var(--transition-fast),
      color var(--transition-fast);
  }

  .category-header:hover .category-docs {
    opacity: 1;
  }

  .category-docs:hover {
    color: var(--accent-primary);
  }

  /* Flag rows */
  .flag-list {
    padding: 0 var(--spacing-md) var(--spacing-sm);
  }

  .flag-row {
    padding: var(--spacing-xs) 0;
  }

  .flag-row.enabled {
    padding: var(--spacing-xs) 0;
  }

  .flag-label-row {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
  }

  .default-flag .flag-value {
    margin-left: 0;
  }

  .flag-toggle {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    cursor: pointer;
    margin: 0;
  }

  .flag-toggle input[type="checkbox"] {
    width: auto;
    accent-color: var(--accent-primary);
  }

  .flag-name {
    font-size: 0.8125rem;
    color: var(--text-secondary);
    flex: 1;
  }

  .flag-code {
    font-size: 0.6875rem;
    color: var(--text-tertiary);
    background: var(--bg-tertiary);
    padding: 1px 5px;
    border-radius: 3px;
    font-family: monospace;
  }

  .flag-value {
    margin-top: var(--spacing-xs);
    margin-left: calc(var(--spacing-sm) + 17px);
  }

  .flag-value input,
  .flag-value select {
    width: 100%;
    padding: var(--spacing-xs) var(--spacing-sm);
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-size: 0.8125rem;
  }

  .flag-value select {
    cursor: pointer;
  }

  .flag-value input:focus,
  .flag-value select:focus {
    outline: none;
    border-color: var(--accent-primary);
  }

  /* Rest */
  .checkbox-label {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    margin-bottom: var(--spacing-lg);
    color: var(--text-secondary);
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
  }

  .checkbox-label input {
    width: auto;
  }

  .error-message {
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid var(--error);
    border-radius: var(--radius-md);
    padding: var(--spacing-md);
    color: var(--error);
    font-size: 0.875rem;
    margin-bottom: var(--spacing-md);
  }

  button[type="submit"] {
    width: 100%;
  }

  @media (max-width: 768px) {
    .download-form {
      padding: var(--spacing-md);
    }

    .profile-buttons {
      gap: var(--spacing-xs);
    }

    .profile-btn {
      flex: 1;
      min-width: 0;
      padding: var(--spacing-sm);
      font-size: 0.8125rem;
    }

    .advanced-header {
      flex-direction: column;
      gap: var(--spacing-sm);
      align-items: flex-start;
    }

    .advanced-actions {
      width: 100%;
    }

    .btn-save-profile,
    .btn-clear-flags {
      flex: 1;
    }
  }
</style>
