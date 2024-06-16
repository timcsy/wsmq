import logging

# LEVEL = logging.DEBUG
LEVEL = logging.INFO
# LEVEL = logging.WARNING

logging.basicConfig(level=LEVEL, format='%(asctime)s - %(levelname)s - %(message)s')