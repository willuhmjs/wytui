import { PrismaClient } from '@prisma/client';
import { execSync } from 'child_process';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // Get yt-dlp version
  let ytdlpVersion = null;
  try {
    ytdlpVersion = execSync('yt-dlp --version').toString().trim();
    console.log(`✅ Detected yt-dlp version: ${ytdlpVersion}`);
  } catch (e) {
    console.warn('⚠️ yt-dlp not found, skipping version detection');
  }

  // Create singleton settings
  const settings = await prisma.settings.upsert({
    where: { id: 'singleton' },
    update: {},
    create: {
      id: 'singleton',
      maxConcurrentDownloads: 3,
      downloadPath: '/downloads',
      ytdlpPath: '/usr/local/bin/yt-dlp',
      ytdlpVersion,
      autoUpdateYtdlp: true,
      updateCheckInterval: 86400,
      enableArchive: true,
    },
  });
  console.log('✅ Created settings:', settings.id);

  // Create system download profiles
  const profiles = [
    // Video Quality Presets (using H.264 for compatibility)
    {
      name: '4K (Best Quality)',
      description: '2160p H.264 video with AAC audio',
      isSystem: true,
      isDefault: false,
      quality: '2160',
      format: 'mp4',
      customFlags: ['-f', 'bestvideo[vcodec^=avc][height<=2160]+bestaudio/best', '--merge-output-format', 'mp4', '--postprocessor-args', 'ffmpeg:-c:a aac -b:a 192k'],
    },
    {
      name: '1080p',
      description: 'Full HD H.264 video with AAC audio',
      isSystem: true,
      isDefault: true,
      quality: '1080',
      format: 'mp4',
      customFlags: ['-f', 'bestvideo[vcodec^=avc]+bestaudio/best', '--merge-output-format', 'mp4', '--postprocessor-args', 'ffmpeg:-c:a aac -b:a 192k'],
    },
    {
      name: '720p',
      description: 'HD H.264 video with AAC audio',
      isSystem: true,
      isDefault: false,
      quality: '720',
      format: 'mp4',
      customFlags: ['-f', 'bestvideo[vcodec^=avc][height<=720]+bestaudio/best', '--merge-output-format', 'mp4', '--postprocessor-args', 'ffmpeg:-c:a aac -b:a 192k'],
    },
    {
      name: '480p (Mobile)',
      description: 'SD H.264 video optimized for mobile',
      isSystem: true,
      isDefault: false,
      quality: '480',
      format: 'mp4',
      customFlags: ['-f', 'bestvideo[vcodec^=avc][height<=480]+bestaudio/best', '--merge-output-format', 'mp4', '--postprocessor-args', 'ffmpeg:-c:a aac -b:a 192k'],
    },

    // Audio Extraction
    {
      name: 'MP3 (320kbps)',
      description: 'High quality MP3 audio',
      isSystem: true,
      isDefault: false,
      audioOnly: true,
      audioFormat: 'mp3',
      audioBitrate: '320k',
      customFlags: ['-x', '--audio-format', 'mp3', '--audio-quality', '0'],
    },
    {
      name: 'AAC (High Quality)',
      description: 'High quality AAC audio',
      isSystem: true,
      isDefault: false,
      audioOnly: true,
      audioFormat: 'aac',
      audioBitrate: '256k',
      customFlags: ['-x', '--audio-format', 'aac', '--audio-quality', '0'],
    },
    {
      name: 'FLAC (Lossless)',
      description: 'Lossless FLAC audio',
      isSystem: true,
      isDefault: false,
      audioOnly: true,
      audioFormat: 'flac',
      customFlags: ['-x', '--audio-format', 'flac'],
    },

    // Smart Defaults
    {
      name: 'Best (Auto)',
      description: 'Best H.264 video with AAC audio',
      isSystem: true,
      isDefault: false,
      customFlags: ['-f', 'bestvideo[vcodec^=avc]+bestaudio/best', '--merge-output-format', 'mp4', '--postprocessor-args', 'ffmpeg:-c:a aac -b:a 192k'],
    },
    {
      name: 'Smallest Size',
      description: 'Lowest quality for minimal file size',
      isSystem: true,
      isDefault: false,
      customFlags: ['-f', 'worstvideo+worstaudio/worst'],
    },
  ];

  for (const profile of profiles) {
    // Check if profile exists
    const existing = await prisma.downloadProfile.findFirst({
      where: { name: profile.name, userId: null },
    });

    if (!existing) {
      const created = await prisma.downloadProfile.create({
        data: profile,
      });
      console.log(`✅ Created profile: ${created.name}`);
    } else {
      console.log(`⏭️  Skipped existing profile: ${existing.name}`);
    }
  }

  console.log('🎉 Seeding complete!');
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error('❌ Seeding failed:', e);
    await prisma.$disconnect();
    process.exit(1);
  });
