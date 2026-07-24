#!/bin/sh
set -eu

clickhouse client --multiquery <<'SQL'
CREATE DATABASE IF NOT EXISTS openpanel;
SQL
