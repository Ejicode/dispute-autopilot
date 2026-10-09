.PHONY: dev build start seed bench test test-attacks clean

dev:
	npm run dev

build:
	npm run build

start:
	npm run start

seed:
	npm run seed

bench:
	npm run bench

test:
	npm run test

test-attacks:
	npm run test:attacks

clean:
	rm -rf .next data/*.db data/*.db-*
