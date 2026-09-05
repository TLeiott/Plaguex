import { resetMock } from './fixtures'

export default async function globalSetup() {
  await resetMock()
}
