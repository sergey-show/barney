# SPI (провайдеры тела)

**Русский** · [English](spi.md)

Ядро остаётся иммунным; адаптация — через **body-провайдеры** на **стабильные порты**. Агент не патчит `src/`.

Предпочитай skill/plugin. SPI — когда нужен повторяемый порт (пилот: `verify`). Новый port id — только human release.

Жизненный цикл: `provider_list` → `provider_write` (quarantine) → `provider_exam` → verified/frozen. Soft `spi_verify:` после Review не меняет вердикт.

Подробности и манифест — в [spi.md](spi.md).
