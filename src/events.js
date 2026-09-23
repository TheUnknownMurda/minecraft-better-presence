// Liste des events connus du protocole WebSocket de Bedrock.
// Mojang en a retire / restreint plusieurs au fil des versions sans jamais
// documenter lesquels : c'est precisement ce que la sonde doit determiner.
export const ALL_EVENTS = [
  'AdditionalContentLoaded', 'AgentCommand', 'AgentCreated', 'ApiInit',
  'AppPaused', 'AppResumed', 'AppSuspended', 'AwardAchievement',
  'BlockBroken', 'BlockPlaced', 'BoardTextUpdated', 'BossKilled',
  'CameraUsed', 'CauldronUsed', 'ChunkChanged', 'ChunkLoaded', 'ChunkUnloaded',
  'ConfigurationChanged', 'ConnectionFailed', 'CraftingSessionCompleted',
  'EndOfDay', 'EntitySpawned', 'FileTransmissionCancelled',
  'FileTransmissionCompleted', 'FileTransmissionStarted', 'FirstTimeClientOpen',
  'FocusGained', 'FocusLost', 'GameSessionComplete', 'GameSessionStart',
  'HardwareInfo', 'HasNewContent', 'ItemAcquired', 'ItemCrafted',
  'ItemDestroyed', 'ItemDropped', 'ItemEnchanted', 'ItemEquipped',
  'ItemInteracted', 'ItemNamed', 'ItemSmelted', 'ItemUsed', 'JoinCanceled',
  'JukeboxUsed', 'LicenseCensus', 'MascotCreated', 'MenuShown',
  'MobInteracted', 'MobKilled', 'MultiplayerConnectionStateChanged',
  'MultiplayerRoundEnd', 'MultiplayerRoundStart', 'NpcPropertiesUpdated',
  'OptionsUpdated', 'PerformanceMetrics', 'PlayerBounced', 'PlayerDied',
  'PlayerJoin', 'PlayerLeave', 'PlayerMessage', 'PlayerTeleported',
  'PlayerTransform', 'PlayerTravelled', 'PortalBuilt', 'PortalUsed',
  'PortfolioExported', 'PotionBrewed', 'PurchaseAttempt', 'PurchaseResolved',
  'RegionalPopup', 'RespondedToAcceptContent', 'ScreenChanged',
  'ScreenHeartbeat', 'SignInToEdu', 'SignInToXboxLive', 'SignOutOfXboxLive',
  'SpecialMobBuilt', 'StartClient', 'StartWorld', 'TextToSpeechToggled',
  'UgcDownloadCompleted', 'UploadSkin', 'VehicleExited', 'WorldExported',
  'WorldFilesListed', 'WorldGenerated', 'WorldLoaded', 'WorldUnloaded',
];

// Events reellement utiles pour construire une presence.
export const PRESENCE_RELEVANT = new Set([
  'BlockBroken', 'BlockPlaced', 'MobKilled', 'PlayerDied', 'PlayerTransform',
  'PlayerTravelled', 'ItemCrafted', 'ItemSmelted', 'ItemEquipped', 'ItemUsed',
  'ItemAcquired', 'AwardAchievement', 'ScreenChanged', 'WorldLoaded',
  'WorldUnloaded', 'PlayerMessage', 'PlayerTeleported', 'EndOfDay',
  'MultiplayerConnectionStateChanged', 'PlayerJoin', 'PlayerLeave',
  'VehicleExited', 'PortalUsed', 'BossKilled',
]);

// Events trop bavards pour etre affiches ligne par ligne dans la console.
export const NOISY = new Set([
  'ScreenHeartbeat', 'PerformanceMetrics', 'ChunkLoaded', 'ChunkUnloaded',
  'ChunkChanged', 'EntitySpawned', 'PlayerTransform', 'BlockBroken',
  'BlockPlaced', 'ItemAcquired',
]);
