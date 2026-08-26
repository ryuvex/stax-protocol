# Runs oracle refresh + both snapshot scripts every 15 minutes, forever,
# until you close this window. Points at v15 (verified deployment:
# 0xC10Ef76b35cB7ae4a68226E3b82F58B1cf4c32f4).
#
# To stop: close this window, or press Ctrl+C.

Write-Host "Starting snapshot loop (oracle refresh + NAV + per-ticker prices, every 15 minutes). Press Ctrl+C to stop." -ForegroundColor Cyan

while ($true) {
    Write-Host ""
    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Refreshing oracles (v15)..." -ForegroundColor Yellow
    npx hardhat run scripts/refresh-all-oracles-v15.ts --network robinhoodTestnet

    Write-Host ""
    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Taking NAV snapshot..." -ForegroundColor Yellow
    npx hardhat run scripts/snapshot-nav.ts --network robinhoodTestnet

    Write-Host ""
    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Taking per-ticker price snapshot..." -ForegroundColor Yellow
    npx hardhat run scripts/snapshot-ticker-prices-v15.ts --network robinhoodTestnet

    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Sleeping 15 minutes..." -ForegroundColor DarkGray
    Start-Sleep -Seconds 900
}