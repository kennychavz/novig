import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { OrderBook, Metrics, Controls, type WorldState } from '../App'

const mockState: WorldState = {
  replica_id: 'rep-1',
  lag_ms: 10,
  game: { x: 50, y: 25, score: '0-0', half: 1, clock: 1000 },
  book: {
    bids: [[69.00, 100], [68.75, 200], [68.50, 300], [68.25, 200], [68.00, 150]],
    asks: [[69.50, 100], [69.75, 200], [70.00, 300], [70.25, 200], [70.50, 150]],
  },
}

describe('OrderBook rendering', () => {
  it('renders top-of-book bid and ask prices', () => {
    render(<OrderBook state={mockState} />)
    expect(screen.getByText('69.00')).toBeInTheDocument()
    expect(screen.getByText('69.50')).toBeInTheDocument()
  })
})

describe('Lag color indicator', () => {
  it('shows text-pos for low lag', () => {
    render(<Metrics lagMs={20} replicaId="rep-1" connected={true} />)
    expect(screen.getByTestId('lag-indicator')).toHaveClass('text-pos')
  })

  it('shows text-neg for high lag', () => {
    render(<Metrics lagMs={300} replicaId="rep-1" connected={true} />)
    expect(screen.getByTestId('lag-indicator')).toHaveClass('text-neg')
  })
})

describe('Replica switch interaction', () => {
  it('calls onReplicaChange with port 8002 URL when Replica 2 clicked', () => {
    const onSwitch = vi.fn()
    const pushLog = vi.fn()
    render(<Controls onReplicaChange={onSwitch} activePort={8001} pushLog={pushLog} />)

    fireEvent.click(screen.getByText('Replica 2'))
    expect(onSwitch).toHaveBeenCalledWith('ws://localhost:8002/ws')
  })
})
